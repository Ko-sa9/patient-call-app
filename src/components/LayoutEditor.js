import React, { useState, useEffect, useCallback, useContext } from 'react'; // ▼ useCallback をインポート
import { useDrop } from 'react-dnd'; // ▼ useDrop をインポート
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'; // (タスク5で使う)
import { db, AppContext } from '../App'; // (タスク5で使う)
import BedButton, { ItemTypes } from './BedButton.js'; // ▼ 作成した BedButton と ItemTypes をインポート

// 仮のベッド番号リスト
const initialBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

// レイアウトエディタコンポーネント
const LayoutEditor = ({ onExit }) => {
  const { selectedFacility } = useContext(AppContext);
  const [bedPositions, setBedPositions] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // ▼ (タスク5用) Firestoreの参照を定義
  const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);

  // ▼ (タスク5用) Firestoreからレイアウト情報を読み込む
  useEffect(() => {
    const loadLayout = async () => {
      setIsLoading(true);
      try {
        const docSnap = await getDoc(layoutDocRef);
        if (docSnap.exists() && docSnap.data().positions) {
          setBedPositions(docSnap.data().positions);
        } else {
          // データがなければ初期位置を（横並びで）設定
          const initialPositions = {};
          const bedsPerRow = 10;
          const horizontalSpacing = 80;
          const verticalSpacing = 60;
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
      } finally {
        setIsLoading(false);
      }
    };
    loadLayout();
  }, [layoutDocRef]); // layoutDocRef は selectedFacility に依存

  // (タスク5用) レイアウトをFirestoreに保存する処理 (中身はまだ)
  const handleSaveLayout = async () => {
    console.log('保存ボタンが押されました:', bedPositions);
    alert('レイアウトを保存しました（仮）');
  };

  // ▼ ベッドがドロップされたときに位置を更新する関数
  const moveBed = useCallback((bedNumber, left, top) => {
    // bedPositions state を更新して、ベッドの新しい位置を記録
    setBedPositions((prevPositions) => ({
      ...prevPositions,
      [bedNumber]: { left, top },
    }));
  }, []); // 空の依存配列

  // ▼ ドロップエリアの設定 (useDrop フック)
  const [, drop] = useDrop(() => ({
    accept: ItemTypes.BED, // 1. BedButton からのドロップ(type: 'bed')のみ受け付ける
    drop(item, monitor) { // 2. ドロップされた時の処理
      // item: BedButtonのuseDragで設定した { bedNumber, left, top }
      
      // ドラッグ開始位置からの移動量 (delta) を取得
      const delta = monitor.getDifferenceFromInitialOffset();
      
      // 元の位置に移動量を足して、新しい位置を計算
      const newLeft = Math.round(item.left + delta.x);
      const newTop = Math.round(item.top + delta.y);

      // moveBed関数を呼び出してstateを更新
      moveBed(item.bedNumber, newLeft, newTop);
      return undefined;
    },
  }), [moveBed]); // 依存配列に moveBed を追加

  if (isLoading) {
    return <LoadingSpinner text="レイアウト情報を読み込み中..." />;
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6 border-b pb-3 no-print">
        <h2 className="text-2xl font-bold">ベッドレイアウト編集（{selectedFacility}）</h2>
        <div>
          <button onClick={handleSaveLayout} disabled={isSaving} className={`bg-blue-600 ...`}>
            {isSaving ? '保存中...' : 'レイアウトを保存'}
          </button>
          <button onClick={onExit} disabled={isSaving} className={`bg-gray-500 ...`}>
            管理画面に戻る
          </button>
        </div>
      </div>

      {/* ▼ ドラッグ＆ドロップエリア (ref={drop} を適用) */}
      <div 
        ref={drop} 
        className="relative border-2 border-dashed border-gray-400 h-[600px] bg-gray-50 rounded-md overflow-hidden"
      >
        {/* ▼ 表示を BedButton コンポーネントに置き換え */}
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