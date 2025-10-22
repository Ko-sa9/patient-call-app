import React, { useState, useEffect, useCallback, useContext } from 'react'; // ▼ useContext をインポート
import { useDrop } from 'react-dnd';
// ▼ Firestore 関連のインポート (コメント解除し、必要なものを追加)
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
// ▼ App.js から db と AppContext をインポート (パスは環境に合わせて確認・修正してください)
import { db, AppContext } from '../App';
import BedButton, { ItemTypes } from './BedButton';

// 仮のベッド番号リスト
const initialBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

// レイアウトエディタコンポーネント
const LayoutEditor = ({ onExit }) => {
  const { selectedFacility } = useContext(AppContext); // ▼ 現在選択中の施設名を取得
  const [bedPositions, setBedPositions] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false); // ▼ 保存中かどうかのフラグを追加

  // ▼ Firestoreのレイアウトドキュメントへの参照を作成
  // ▼ コレクション名を 'bedLayouts', ドキュメントIDを選択中の施設名にする
  const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);

  // --- Firestoreからレイアウト情報を読み込む処理 ---
  useEffect(() => {
    const loadLayout = async () => {
      setIsLoading(true); // 読み込み開始
      try {
        const docSnap = await getDoc(layoutDocRef); // Firestoreからドキュメントを取得
        if (docSnap.exists() && docSnap.data().positions) {
          // 保存されたデータがあればそれをセット
          setBedPositions(docSnap.data().positions);
          console.log("Saved layout loaded:", docSnap.data().positions);
        } else {
          // データがなければ初期位置を設定
          console.log("No saved layout found, using initial positions.");
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
        alert('レイアウトの読み込みに失敗しました。');
        // エラー時も初期位置を設定するなどのフォールバック処理を追加しても良い
      } finally {
        setIsLoading(false); // 読み込み完了
      }
    };

    loadLayout();
  }, [layoutDocRef]); // layoutDocRefが変わることは通常ないが、依存配列に追加

  // --- レイアウトをFirestoreに保存する処理 ---
  const handleSaveLayout = async () => {
    setIsSaving(true); // 保存開始
    try {
      // ▼ Firestoreドキュメントに現在のbedPositionsを保存（上書き）
      await setDoc(layoutDocRef, { positions: bedPositions });
      alert('レイアウトを保存しました！');
      console.log('Layout saved:', bedPositions);
    } catch (error) {
      console.error("Error saving layout:", error);
      alert('レイアウトの保存に失敗しました。');
    } finally {
      setIsSaving(false); // 保存完了
    }
  };

  // --- ベッドがドロップされたときに位置を更新する関数 (変更なし) ---
  const moveBed = useCallback((bedNumber, left, top) => {
    setBedPositions((prevPositions) => ({
      ...prevPositions,
      [bedNumber]: { left, top },
    }));
  }, []);

  // --- ドロップエリアの設定 (変更なし) ---
  const [, drop] = useDrop(() => ({
    accept: ItemTypes.BED,
    drop(item, monitor) {
      const delta = monitor.getDifferenceFromInitialOffset();
      const newLeft = Math.round(item.left + delta.x);
      const newTop = Math.round(item.top + delta.y);
      moveBed(item.bedNumber, newLeft, newTop);
      return undefined;
    },
  }), [moveBed]);

  // --- レンダリング ---
  if (isLoading) {
    return <LoadingSpinner text="レイアウト情報を読み込み中..." />; // ローディング表示
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6 border-b pb-3 no-print">
        <h2 className="text-2xl font-bold">ベッドレイアウト編集（{selectedFacility}）</h2> {/* ▼ 施設名を表示 */}
        <div>
          {/* ▼ 保存中はボタンを無効化 */}
          <button onClick={handleSaveLayout} disabled={isSaving} className={`bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg mr-4 ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}>
            {isSaving ? '保存中...' : 'レイアウトを保存'}
          </button>
          <button onClick={onExit} disabled={isSaving} className={`bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg ${isSaving ? 'opacity-50 cursor-not-allowed' : ''}`}>
            管理画面に戻る
          </button>
        </div>
      </div>

      <div
        ref={drop}
        className="relative border-2 border-dashed border-gray-400 h-[600px] bg-gray-50 rounded-md overflow-hidden"
      >
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