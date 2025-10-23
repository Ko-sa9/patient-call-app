import React, { useState, useEffect, useCallback, useContext } from 'react';
import { useDrop } from 'react-dnd';
// Firestore 関連のインポート
import { getDoc, setDoc, doc } from 'firebase/firestore';
// App.js から db, AppContext, LoadingSpinner をインポート
// (App.js側で export const db = ... のように export されている必要があります)
import { db, AppContext, LoadingSpinner } from '../App';
import BedButton, { ItemTypes } from './BedButton.js';

// 入院透析室のベッド番号リスト（20床）
const initialBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

/**
 * ベッドのレイアウトを編集するためのエディタコンポーネント
 * @param {object} props - { onExit: 管理画面に戻るための関数 }
 */
const LayoutEditor = ({ onExit }) => {
  const { selectedFacility } = useContext(AppContext); // 現在選択中の施設名
  const [bedPositions, setBedPositions] = useState({}); // ベッドの位置情報 { "1": {top, left}, ... }
  const [isLoading, setIsLoading] = useState(true); // 読み込み中フラグ
  const [isSaving, setIsSaving] = useState(false); // 保存中フラグ

  // Firestoreのレイアウトドキュメントへの参照
  // 'bedLayouts' コレクション / {施設名} ドキュメント
  const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);

  // --- 1. レイアウト情報の読み込み ---
  // コンポーネントのマウント時にFirestoreから保存されたレイアウトを読み込む
  useEffect(() => {
    const loadLayout = async () => {
      setIsLoading(true);
      try {
        const docSnap = await getDoc(layoutDocRef);
        if (docSnap.exists() && docSnap.data().positions) {
          // 1-1. 保存されたデータがあれば、それをstateにセット
          setBedPositions(docSnap.data().positions);
          console.log("Saved layout loaded:", docSnap.data().positions);
        } else {
          // 1-2. データがなければ、初期位置を計算してセット
          console.log("No saved layout found, using initial positions.");
          const initialPositions = {};
          const bedsPerRow = 10; // 1行に並べるベッド数
          const horizontalSpacing = 80; // 横間隔
          const verticalSpacing = 60;   // 縦間隔
          const startLeft = 50;
          const startTop = 50;

          initialBedNumbers.forEach((bedNumber, index) => {
            const colIndex = index % bedsPerRow;
            const rowIndex = Math.floor(index / bedsPerRow);
            initialPositions[bedNumber] = {
              top: startTop + (rowIndex * verticalSpacing),
              left: startLeft + (colIndex * horizontalSpacing)
            };
          });
          setBedPositions(initialPositions);
        }
      } catch (error) {
        console.error("Error loading layout:", error);
        alert('レイアウトの読み込みに失敗しました。');
      } finally {
        setIsLoading(false); // 読み込み完了
      }
    };

    loadLayout();
  }, [layoutDocRef]); // 施設名が変わると layoutDocRef が変わるので再実行

  // --- 2. レイアウトの保存 ---
  // 「レイアウトを保存」ボタンが押されたときの処理
  const handleSaveLayout = async () => {
    setIsSaving(true);
    try {
      // Firestoreドキュメントに現在の bedPositions state を 'positions' フィールドとして保存
      await setDoc(layoutDocRef, { positions: bedPositions });
      alert('レイアウトを保存しました！');
      console.log('Layout saved:', bedPositions);
    } catch (error) {
      console.error("Error saving layout:", error);
      alert('レイアウトの保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  // --- 3. ドラッグ＆ドロップ処理 ---

  // ベッドがドロップされたときに state を更新する関数
  const moveBed = useCallback((bedNumber, left, top) => {
    setBedPositions((prevPositions) => ({
      ...prevPositions,
      [bedNumber]: { left, top }, // 特定のベッド番号の位置だけを更新
    }));
  }, []); // この関数自体は再生成不要

  // ドロップエリア（ベッドを配置する背景エリア）の設定
  const [, drop] = useDrop(() => ({
    accept: ItemTypes.BED, // BedButton.js で定義した 'bed' タイプのみ受け入れる
    drop(item, monitor) {
      // item: ドラッグ開始時に BedButton から渡された情報 { bedNumber, left, top }
      
      // ドラッグ開始位置からの移動差分 (delta) を取得
      const delta = monitor.getDifferenceFromInitialOffset();
      
      // 新しい左上座標を計算 (元の位置 + 移動差分)
      const newLeft = Math.round(item.left + delta.x);
      const newTop = Math.round(item.top + delta.y);

      // state を更新してベッドを移動させる
      moveBed(item.bedNumber, newLeft, newTop);
      return undefined;
    },
  }), [moveBed]); // moveBed が変更されたら（通常はない）このフックも再計算

  // --- レンダリング ---
  if (isLoading) {
    return <LoadingSpinner text="レイアウト情報を読み込み中..." />;
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {/* ヘッダー：タイトルとボタン類 */}
      <div className="flex justify-between items-center mb-6 border-b pb-3 no-print">
        <h2 className="text-2xl font-bold">ベッドレイアウト編集（{selectedFacility}）</h2>
        <div>
          <button 
            onClick={handleSaveLayout} 
            disabled={isSaving} // 保存中はボタンを無効化
            className={`bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg mr-4 ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSaving ? '保存中...' : 'レイアウトを保存'}
          </button>
          <button 
            onClick={onExit} 
            disabled={isSaving} // 保存中は戻るボタンも無効化
            className={`bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            管理画面に戻る
          </button>
        </div>
      </div>

      {/* ドロップエリア (ref={drop} でドロップ先として登録) */}
      <div 
        ref={drop} 
        className="relative border-2 border-dashed border-gray-400 h-[600px] bg-gray-50 rounded-md overflow-hidden"
      >
        {/* bedPositions state に基づいて BedButton コンポーネントを描画 */}
        {Object.keys(bedPositions).map((bedNumber) => (
          <BedButton
            key={bedNumber}
            bedNumber={bedNumber}
            left={bedPositions[bedNumber].left}
            top={bedPositions[bedNumber].top}
          />
        ))}
      </div>
    </div>
  );
};

export default LayoutEditor;