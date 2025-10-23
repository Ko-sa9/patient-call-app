import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
// App.jsから主要コンポーネントと変数をインポート
// (App.js側で AppLayout, AppContext, db, LoadingSpinner が export されている必要があります)
import { AppLayout, AppContext, db, LoadingSpinner } from '../App'; 
import LayoutEditor from './LayoutEditor.js'; // レイアウトエディタ
import BedButton from './BedButton.js'; // ベッドボタン
import { doc, onSnapshot } from 'firebase/firestore'; // Firestoreからリアルタイムで読み込む

// --- 定数・ヘルパー関数 ---
const inpatientBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

// ベッドの状態に応じたスタイルを返す関数
const getBedStatusStyle = (status) => {
  switch (status) {
    case '準備完了': // スタッフがタップ
      return 'bg-yellow-500 animate-pulse'; // 黄色点滅
    case '連絡済': // クラークがタップ
      return 'bg-gray-400'; // グレー
    case '治療中': // デフォルト
    default:
      return 'bg-blue-500'; // 青
  }
};

// --- ① 管理画面コンポーネント (モニター機能含む) ---
const InpatientAdminPage = () => {
  const { selectedFacility } = useContext(AppContext);
  const [isLayoutEditMode, setLayoutEditMode] = useState(false); // レイアウト編集モードか
  const [bedLayout, setBedLayout] = useState(null); // レイアウトデータ { "1": {top, left}, ... }
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [bedStatuses, setBedStatuses] = useState({}); // ベッドの状態 { "1": "治療中", ... }
  const [loadingStatuses, setLoadingStatuses] = useState(true); // 状態読み込み中フラグ

  // --- 1. レイアウトの読み込み (タスク7) ---
  useEffect(() => {
    setLoadingLayout(true);
    const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);
    // onSnapshotでレイアウトの変更をリアルタイムに監視
    const unsubscribeLayout = onSnapshot(layoutDocRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().positions) {
        setBedLayout(docSnap.data().positions);
        console.log("AdminPage: Layout loaded/updated:", docSnap.data().positions);
      } else {
        setBedLayout({}); // データがない場合は空オブジェクト
        console.log("AdminPage: No saved layout found.");
      }
      setLoadingLayout(false);
    }, (error) => {
      console.error("AdminPage: Error loading layout:", error);
      setBedLayout({}); // エラー時も空オブジェクト
      setLoadingLayout(false);
    });
    return () => unsubscribeLayout(); // 監視を解除
  }, [selectedFacility]);

  // --- 2. ベッド状態の読み込み (タスク8で実装予定) ---
  useEffect(() => {
     setLoadingStatuses(true);
     // ▼ 本来はFirestoreからベッド状態を onSnapshot でリアルタイム読み込みする
     // const statusDocRef = doc(db, 'bedStatuses', `${selectedFacility}_${/*日付など*/}`);
     // const unsubscribeStatuses = onSnapshot(statusDocRef, (docSnap) => { ... });
     
     // (仮実装) 全て「治療中」で初期化
     const initialStatuses = {};
     inpatientBedNumbers.forEach(num => {
       initialStatuses[num] = '治療中';
     });
     setBedStatuses(initialStatuses);
     setLoadingStatuses(false);
     console.log("AdminPage: Initial bed statuses set (dummy).");
     
     // (仮実装) 5秒後に2番ベッドを「準備完了」にしてみるテスト
     const timer = setTimeout(() => {
        setBedStatuses(prev => ({...prev, "2": "準備完了"}));
     }, 5000);

     // ▼ クリーンアップ関数
     // return () => unsubscribeStatuses();
     return () => clearTimeout(timer);
   }, [selectedFacility]); // selectedFacilityや日付が変わったら再読み込み

  // --- 3. クラークさんによる状態リセット (タスク10で実装予定) ---
  const handleBedReset = (bedNumber) => {
    console.log(`Clerk reset bed ${bedNumber} (dummy)`);
    // ▼ ここでFirestoreの状態を「連絡済」または「治療中」に更新する (タスク10)
    // await updateBedStatus(bedNumber, '連絡済');
    
    // (仮実装) stateを「連絡済」にする
    setBedStatuses(prev => ({...prev, [bedNumber]: '連絡済'}));
  };

  // --- 4. 音声通知 (タスク8で実装予定) ---
  useEffect(() => {
    // bedStatuses の変更を監視し、「準備完了」になったベッドがあれば音声を再生する
    // (useCallback + useRef を使った前回のMonitorPageのロジックをここに移植)
    
    // (仮実装) 状態が「準備完了」になったらコンソールにログを出す
    const readyBeds = Object.keys(bedStatuses).filter(bed => bedStatuses[bed] === '準備完了');
    if (readyBeds.length > 0) {
        console.log("音声通知トリガー:", readyBeds.join(', '), "番ベッドが準備完了です。");
        // ここで音声再生キューに追加する処理 (タスク8)
    }
  }, [bedStatuses]);


  // --- レンダリング ---
  // レイアウト編集モードの場合
  if (isLayoutEditMode) {
    // LayoutEditorコンポーネントを表示（このコンポーネントは別ファイル src/components/LayoutEditor.js のまま）
    return <LayoutEditor onExit={() => setLayoutEditMode(false)} />;
  }

  // データ読み込み中の場合
  if (loadingLayout || loadingStatuses) {
    return <LoadingSpinner text="ベッド情報とレイアウトを読み込み中..." />;
  }

  // 通常の管理（モニター）画面
  return (
    <div>
      {/* レイアウト編集ボタン (印刷しない) */}
      <div className="bg-white p-6 rounded-lg shadow mb-6 no-print">
        <h3 className="text-xl font-semibold text-gray-800 border-b pb-3 mb-4">レイアウト設定</h3>
        <button
          onClick={() => setLayoutEditMode(true)} // クリックで編集モードに入る
          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg"
        >
          ベッド配置を編集する
        </button>
      </div>

      {/* クラークさん用モニター表示エリア */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">ベッド状況モニター</h3>
        {/* レイアウト表示エリア */}
        <div className="relative border border-gray-300 h-[600px] bg-gray-50 rounded-md overflow-hidden">
          {bedLayout && Object.keys(bedLayout).map((bedNumber) => {
            const position = bedLayout[bedNumber];
            const status = bedStatuses[bedNumber] || '不明'; // 状態を取得
            const statusStyle = getBedStatusStyle(status);
            const isReady = status === '準備完了'; // 「準備完了」状態か

            return (
              <button // クラークがリセット操作できるようにボタン化
                key={bedNumber}
                className={`absolute p-2 text-white rounded shadow text-center font-bold ${statusStyle} ${!isReady ? 'cursor-not-allowed' : 'hover:opacity-80 active:scale-95'}`}
                style={{
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  width: '60px', // ボタンサイズ (調整可)
                  height: '40px',
                  lineHeight: '24px'
                }}
                onClick={() => handleBedReset(bedNumber)} // タップでリセット処理
                disabled={!isReady} // 「準備完了」のベッドのみ操作可能
              >
                {bedNumber}
              </button>
            );
          })}
          {/* レイアウトが未設定の場合のメッセージ */}
          {(!bedLayout || Object.keys(bedLayout).length === 0) && (
             <p className="text-center text-gray-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
               レイアウトが設定されていません。「レイアウト設定」から配置してください。
             </p>
           )}
        </div>
      </div>
    </div>
  );
};


// --- ② スタッフ画面コンポーネント ---
const InpatientStaffPage = () => {
  const { selectedFacility } = useContext(AppContext);
  const [bedLayout, setBedLayout] = useState(null); // レイアウトデータ
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [bedStatuses, setBedStatuses] = useState({}); // ベッドの状態
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  
  // ▼ QRスキャナ関連 (タスク9で使う)
  // const [isScannerOpen, setScannerOpen] = useState(false);
  // const { QrScannerModal } = useContext(AppContext); // App.jsから受け取る想定

  // --- 1. レイアウトの読み込み (AdminPageと同様) ---
  useEffect(() => {
    setLoadingLayout(true);
    const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);
    const unsubscribeLayout = onSnapshot(layoutDocRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().positions) {
        setBedLayout(docSnap.data().positions);
        console.log("StaffPage: Layout loaded/updated:", docSnap.data().positions);
      } else {
        setBedLayout({});
        console.log("StaffPage: No saved layout found.");
      }
      setLoadingLayout(false);
    }, (error) => {
      console.error("StaffPage: Error loading layout:", error);
      setBedLayout({});
      setLoadingLayout(false);
    });
    return () => unsubscribeLayout();
  }, [selectedFacility]);

  // --- 2. ベッド状態の読み込み (AdminPageと同様, タスク8で実装予定) ---
  useEffect(() => {
     setLoadingStatuses(true);
     // ▼ Firestoreからベッド状態をリアルタイムで読み込む (タスク8)
     // (仮実装)
     const initialStatuses = {};
     inpatientBedNumbers.forEach(num => {
       initialStatuses[num] = '治療中';
     });
     setBedStatuses(initialStatuses);
     setLoadingStatuses(false);
     console.log("StaffPage: Initial bed statuses set (dummy).");
     
     const timer = setTimeout(() => {
        setBedStatuses(prev => ({...prev, "2": "準備完了"}));
     }, 5000);

     return () => clearTimeout(timer);
   }, [selectedFacility]);

  // --- 3. ベッドタップ時の処理 (タスク8で実装) ---
  const handleBedTap = (bedNumber) => {
    const currentStatus = bedStatuses[bedNumber];
    
    // 「治療中」の場合のみ「準備完了」にできる
    if (currentStatus === '治療中') {
      console.log(`Staff tapped bed ${bedNumber}. Changing to 準備完了 (dummy)`);
      // ▼ ここで Firestore に bedNumber の状態を '準備完了' に更新する処理 (タスク8)
      // await updateBedStatusInFirestore(bedNumber, '準備完了');

      // (仮実装) stateを「準備完了」にする
      setBedStatuses(prev => ({...prev, [bedNumber]: '準備完了'}));
    } else {
      console.log(`Bed ${bedNumber} tapped, but status is ${currentStatus}. No change.`);
    }
  };
  
  // --- 4. QRスキャン成功時の処理 (タスク9で実装) ---
  // const handleScanSuccess = useCallback((scannedBedNumber) => {
  //   if (inpatientBedNumbers.includes(scannedBedNumber)) {
  //     console.log(`QR Scan success: ${scannedBedNumber}`);
  //     handleBedTap(scannedBedNumber); // タップ処理を呼び出す
  //     return { success: true, message: `${scannedBedNumber}番ベッドを通知しました。` };
  //   } else {
  //     return { success: false, message: '有効なベッド番号ではありません。' };
  //   }
  // }, [bedStatuses]); // handleBedTapをuseCallbackで囲むなら、それも依存配列に


  // --- レンダリング ---
  if (loadingLayout || loadingStatuses) {
    return <LoadingSpinner text="ベッド情報とレイアウトを読み込み中..." />;
  }

  return (
    <div>
      {/* ▼ QRスキャナ関連 (タスク9で有効化) */}
      {/* {isScannerOpen && 
        <QrScannerModal 
          onClose={() => setScannerOpen(false)} 
          onScanSuccess={handleScanSuccess} 
        />
      } */}
      
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold text-gray-800">ベッド操作</h3>
            {/* ▼ QRスキャンボタン (タスク9で有効化) */}
            {/* <button 
              onClick={() => setScannerOpen(true)}
              title="QRで呼び出し" 
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-3 rounded-lg transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" ... />
            </button> 
            */}
        </div>
        
        {/* ▼ レイアウト表示エリア */}
        <div className="relative border border-gray-300 h-[600px] bg-gray-50 rounded-md overflow-hidden">
          {bedLayout && Object.keys(bedLayout).map((bedNumber) => {
            const position = bedLayout[bedNumber];
            const status = bedStatuses[bedNumber] || '不明';
            const statusStyle = getBedStatusStyle(status);
// 既に通知済・連絡済なら押せない
            const isDisabled = status === '準備完了' || status === '連絡済'; 

            return (
              <button // ▼ div を button に変更
                key={bedNumber}
                className={`absolute p-2 text-white rounded shadow text-center font-bold transition-all duration-200 ${statusStyle} ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 active:scale-95'}`}
                style={{
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  width: '60px',
                  height: '40px',
                  lineHeight: '24px'
                }}
                onClick={() => handleBedTap(bedNumber)} // ▼ タップ時の処理
                disabled={isDisabled} // ▼ 押せるかどうか
              >
                {bedNumber}
              </button>
            );
          })}
           {(!bedLayout || Object.keys(bedLayout).length === 0) && (
             <p className="text-center text-gray-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
               レイアウトが設定されていません。管理画面で設定してください。
             </p>
           )}
        </div>
      </div>
    </div>
  );
};


// --- ③ 親コンポーネント (タブ切り替え) ---
// このファイル自体を App.js から InpatientView としてインポートする
const InpatientView = ({ user, onGoBack }) => {
  const [currentPage, setCurrentPage] = useState('staff'); // 初期表示はスタッフ画面

  // ページ切り替えボタン
  const NavButton = ({ page, label }) => (
    <button
      onClick={() => setCurrentPage(page)}
      className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition duration-200 text-sm sm:text-base ${
        currentPage === page
          ? 'bg-blue-600 text-white shadow-md'
          : 'bg-white text-gray-700 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );

  // 現在のページに応じてコンポーネントをレンダリング
  const renderPage = () => {
    switch (currentPage) {
      case 'admin':
        return <InpatientAdminPage />; // このファイル内で定義したAdminPage
      case 'staff':
        return <InpatientStaffPage />; // このファイル内で定義したStaffPage
      default:
        return <InpatientStaffPage />;
    }
  };

  // App.jsからインポートしたAppLayoutを使って画面を構築
  return (
    <AppLayout
      user={user}
      onGoBack={onGoBack}
      hideCoolSelector={true} // 入院透析室ではクール選択を非表示
      navButtons={
        <>
          <NavButton page="staff" label="スタッフ" />
          <NavButton page="admin" label="管理" />
        </>
      }
    >
      {renderPage()}
    </AppLayout>
  );
};

export default InpatientView;

