import React, { useState, useEffect, useCallback } from 'react'; // ▼ useCallback をインポート
// ▼ useDrop と Firestore 関連をインポート (コメント解除)
import { useDrop } from 'react-dnd';
// import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'; // Firestore関連はまだコメントアウト
import BedButton, { ItemTypes } from './BedButton'; // ▼ 作成した BedButton をインポート

// 仮のベッド番号リスト
const initialBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

// レイアウトエディタコンポーネント
const LayoutEditor = ({ onExit }) => {
  const [bedPositions, setBedPositions] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  // Firestoreからレイアウト情報を読み込む処理 (後で実装)
  useEffect(() => {
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
    setIsLoading(false);
  }, []);

  // レイアウトをFirestoreに保存する処理 (後で実装)
  const handleSaveLayout = async () => {
    console.log('保存ボタンが押されました:', bedPositions);
    alert('レイアウトを保存しました（仮）');
  };

  // ▼ ベッドがドロップされたときに位置を更新する関数
  const moveBed = useCallback((bedNumber, left, top) => {
    setBedPositions((prevPositions) => ({
      ...prevPositions,
      [bedNumber]: { left, top },
    }));
  }, []); // 空の依存配列

  // ▼ ドロップエリアの設定 (useDrop フック)
  const [, drop] = useDrop(() => ({
    accept: ItemTypes.BED, // BedButton からのドロップのみ受け付ける
    drop(item, monitor) {
      // item: BedButtonのuseDragで設定した item オブジェクト ({ bedNumber, left, top })
      // monitor: ドラッグ＆ドロップの状態を監視するオブジェクト

      // ドロップされた位置(delta)を計算
      const delta = monitor.getDifferenceFromInitialOffset(); // ドラッグ開始位置からの移動量 {x, y}
      
      // 新しい左上座標を計算
      const newLeft = Math.round(item.left + delta.x);
      const newTop = Math.round(item.top + delta.y);

      // moveBed関数を呼び出してstateを更新
      moveBed(item.bedNumber, newLeft, newTop);

      // dropの結果としてundefinedを返す (必須ではないが推奨)
      return undefined;
    },
  }), [moveBed]); // 依存配列に moveBed を追加

  // --- レンダリング ---
  if (isLoading) {
    return <div>レイアウト情報を読み込み中...</div>;
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-6 border-b pb-3 no-print"> {/* ▼ no-print を追加 */}
        <h2 className="text-2xl font-bold">ベッドレイアウト編集（入院透析室）</h2>
        <div>
          <button onClick={handleSaveLayout} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg mr-4">
            レイアウトを保存
          </button>
          <button onClick={onExit} className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg">
            管理画面に戻る
          </button>
        </div>
      </div>

      {/* ▼ ドラッグ＆ドロップエリア (ref={drop} を適用) */}
      <div 
        ref={drop} 
        className="relative border-2 border-dashed border-gray-400 h-[600px] bg-gray-50 rounded-md overflow-hidden"
      >
        {/* ▼ BedButton コンポーネントを使ってベッドを表示 */}
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