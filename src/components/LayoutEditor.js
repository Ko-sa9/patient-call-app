import React, { useState, useEffect } from 'react';
// import { useDrag, useDrop } from 'react-dnd'; // react-dnd のフックは後で追加します
// import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore'; // Firestore関連も後で追加します

// 仮のベッド番号リスト (入院透析室は20床)
const initialBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

// レイアウトエディタコンポーネント
const LayoutEditor = ({ onExit }) => {
  // ベッドの位置情報を管理するstate。キーがベッド番号、値が { top: Y座標, left: X座標 }
  const [bedPositions, setBedPositions] = useState({});
  const [isLoading, setIsLoading] = useState(true); // レイアウト読み込み中のフラグ

  // --- Firestoreからレイアウト情報を読み込む処理 (後で実装) ---
  useEffect(() => {
    // ここでFirestoreから保存されたベッドの位置情報を非同期で取得する
    // 例: const savedLayout = await loadLayoutFromFirestore();
    // setBedPositions(savedLayout || {}); // 保存されたデータがあればセット
    
// ↓ 横並びで折り返す初期位置を設定する仮処理
    const initialPositions = {};
    const bedsPerRow = 10; // 1行に並べるベッドの数 (調整可能)
    const horizontalSpacing = 80; // 横方向の間隔 (px)
    const verticalSpacing = 60;   // 縦方向の間隔 (px)
    const startLeft = 50;         // 左端の開始位置 (px)
    const startTop = 50;          // 上端の開始位置 (px)

    initialBedNumbers.forEach((bedNumber, index) => {
      const colIndex = index % bedsPerRow;         // 列のインデックス (0から始まる)
      const rowIndex = Math.floor(index / bedsPerRow); // 行のインデックス (0から始まる)
      
      initialPositions[bedNumber] = { 
        top: startTop + (rowIndex * verticalSpacing), 
        left: startLeft + (colIndex * horizontalSpacing) 
      };
    });
    setBedPositions(initialPositions);
    setIsLoading(false); // 読み込み完了
  }, []);
  
  // --- レイアウトをFirestoreに保存する処理 (後で実装) ---
  const handleSaveLayout = async () => {
    console.log('保存ボタンが押されました:', bedPositions);
    // ここで bedPositions の内容をFirestoreに保存する処理を実装
    // 例: await saveLayoutToFirestore(bedPositions);
    alert('レイアウトを保存しました（仮）');
  };

  // --- ベッドボタンをドラッグ可能にする処理 (後で実装) ---
  // react-dnd の useDrag フックを使うコンポーネント (BedButton など) を別途作成します

  // --- ベッドをドロップするエリアの処理 (後で実装) ---
  // react-dnd の useDrop フックを使うコンポーネント (DropArea など) を作成します


  // --- レンダリング ---
  if (isLoading) {
    return <div>レイアウト情報を読み込み中...</div>; // LoadingSpinnerを使ってもOK
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      {/* ヘッダー：タイトルとボタン */}
      <div className="flex justify-between items-center mb-6 border-b pb-3">
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

      {/* ドラッグ＆ドロップエリア (ここに useDrop を適用する) */}
      <div className="relative border-2 border-dashed border-gray-400 h-[600px] bg-gray-50 rounded-md overflow-hidden">
        {/* ベッド番号ボタンの表示 (ここに useDrag を適用する) */}
        {initialBedNumbers.map((bedNumber) => (
          bedPositions[bedNumber] && ( // 位置情報があるベッドのみ表示
            <div
              key={bedNumber}
              className="absolute p-2 bg-blue-500 text-white rounded shadow cursor-grab active:cursor-grabbing"
              style={{ 
                left: `${bedPositions[bedNumber].left}px`, 
                top: `${bedPositions[bedNumber].top}px`,
                touchAction: 'none' // スマホでのドラッグ用
              }}
            >
              {bedNumber}
            </div>
          )
        ))}
      </div>
    </div>
  );
};

export default LayoutEditor;