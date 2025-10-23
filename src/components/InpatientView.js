import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
// App.jsから主要コンポーネントと変数をインポート
import { AppLayout, AppContext, db, LoadingSpinner } from '../App'; 
import LayoutEditor from './LayoutEditor.js'; // レイアウトエディタ
import BedButton from './BedButton.js'; // ベッドボタン
// ▼ updateDoc, setDoc, getDoc を Firestore からインポート
import { doc, onSnapshot, updateDoc, setDoc, getDoc } from 'firebase/firestore'; 

// --- 定数・ヘルパー関数 ---
const inpatientBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

const getBedStatusStyle = (status) => {
  switch (status) {
    case '準備完了': 
      return 'bg-yellow-500 animate-pulse'; // 黄色点滅
    case '連絡済': 
      return 'bg-gray-400'; // グレー
    case '治療中': 
    default:
      return 'bg-blue-500'; // 青
  }
};

// --- ① 管理画面コンポーネント (モニター機能含む) ---
const InpatientAdminPage = () => {
  // ▼ selectedDate も AppContext から取得
  const { selectedFacility, selectedDate } = useContext(AppContext); 
  const [isLayoutEditMode, setLayoutEditMode] = useState(false);
  const [bedLayout, setBedLayout] = useState(null); 
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [bedStatuses, setBedStatuses] = useState({}); 
  const [loadingStatuses, setLoadingStatuses] = useState(true); 

  // ▼ 日付と施設に基づいたベッド状態ドキュメントへの参照
  const statusDocRef = doc(db, 'bedStatuses', `${selectedFacility}_${selectedDate}`);
  const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);

  // --- 1. レイアウトの読み込み (変更なし) ---
  useEffect(() => {
    setLoadingLayout(true);
    const unsubscribeLayout = onSnapshot(layoutDocRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().positions) {
        setBedLayout(docSnap.data().positions);
      } else {
        setBedLayout({}); 
      }
      setLoadingLayout(false);
    }, (error) => {
      console.error("AdminPage: Error loading layout:", error);
      setBedLayout({}); 
      setLoadingLayout(false);
    });
    return () => unsubscribeLayout();
  }, [layoutDocRef]); // selectedFacilityが変わると layoutDocRef が変わる

  // ▼--- 2. ベッド状態の読み込み (Firestore連携に修正) ---▼
  useEffect(() => {
     setLoadingStatuses(true);
     
     // 今日のベッド状態ドキュメントをリアルタイムで監視
     const unsubscribeStatuses = onSnapshot(statusDocRef, async (docSnap) => {
       if (docSnap.exists()) {
         // ドキュメントがあれば、そのデータをstateにセット
         setBedStatuses(docSnap.data());
         console.log("AdminPage: Bed statuses loaded/updated.");
       } else {
         // ドキュメントがなければ（その日最初のアクセス）、初期化処理
         console.log("AdminPage: No status doc found. Initializing...");
         const initialStatuses = {};
         inpatientBedNumbers.forEach(num => {
           initialStatuses[num] = '治療中'; // 全て「治療中」で初期化
         });
         try {
           await setDoc(statusDocRef, initialStatuses); // Firestoreに初期ドキュメント作成
           setBedStatuses(initialStatuses); // stateにもセット
           console.log("AdminPage: Initial bed statuses created and set.");
         } catch (error) {
           console.error("Error initializing bed statuses:", error);
         }
       }
       setLoadingStatuses(false);
     }, (error) => {
        console.error("AdminPage: Error loading bed statuses:", error);
        setLoadingStatuses(false);
     });

     // クリーンアップ関数
     return () => unsubscribeStatuses();
   }, [statusDocRef]); // selectedFacility や selectedDate が変わると statusDocRef が変わる

  // ▼--- 3. クラークさんによる状態リセット (Firestore連携に修正) ---▼
  const handleBedReset = async (bedNumber) => {
    // 押されたベッドの状態が「準備完了」の場合のみ実行
    if (bedStatuses[bedNumber] !== '準備完了') return; 

    console.log(`Clerk reset bed ${bedNumber}`);
    try {
      // Firestoreの該当ベッド番号のフィールドを「連絡済」に更新
      await updateDoc(statusDocRef, {
        [bedNumber]: "連絡済" 
      });
    } catch (error) {
      console.error(`Error resetting bed ${bedNumber}:`, error);
      alert('状態の更新に失敗しました。');
    }
  };

  // --- 4. 音声通知 (タスク8bで実装予定) ---
  useEffect(() => {
    // (仮実装) 
    const readyBeds = Object.keys(bedStatuses).filter(bed => bedStatuses[bed] === '準備完了');
    if (readyBeds.length > 0) {
        console.log("音声通知トリガー (Admin):", readyBeds.join(', '), "番ベッドが準備完了です。");
    }
  }, [bedStatuses]);


  // --- レンダリング ---
  if (isLayoutEditMode) {
    return <LayoutEditor onExit={() => setLayoutEditMode(false)} />;
  }
  if (loadingLayout || loadingStatuses) {
    return <LoadingSpinner text="ベッド情報とレイアウトを読み込み中..." />;
  }

  // 通常の管理（モニター）画面
  return (
    <div>
      {/* レイアウト編集ボタン */}
      <div className="bg-white p-6 rounded-lg shadow mb-6 no-print">
        {/* ... (変更なし) ... */}
        <h3 className="text-xl font-semibold text-gray-800 border-b pb-3 mb-4">レイアウト設定</h3>
        <button
          onClick={() => setLayoutEditMode(true)}
          className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg"
        >
          ベッド配置を編集する
        </button>
      </div>

      {/* クラークさん用モニター表示エリア */}
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">ベッド状況モニター</h3>
        <div className="relative border border-gray-300 h-[600px] bg-gray-50 rounded-md overflow-hidden">
          {bedLayout && Object.keys(bedLayout).map((bedNumber) => {
            const position = bedLayout[bedNumber];
            // ▼ bedStatuses から最新の状態を取得
            const status = bedStatuses[bedNumber] || '治療中'; 
            const statusStyle = getBedStatusStyle(status);
            const isReady = status === '準備完了';

            return (
              <button
                key={bedNumber}
                className={`absolute p-2 text-white rounded shadow text-center font-bold ${statusStyle} ${!isReady ? 'cursor-not-allowed' : 'hover:opacity-80 active:scale-95'}`}
                style={{
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  width: '60px',
                  height: '40px',
                  lineHeight: '24px'
                }}
                onClick={() => handleBedReset(bedNumber)} // ▼ タップでリセット処理
                disabled={!isReady} // 「準備完了」のベッドのみ操作可能
              >
                {bedNumber}
              </button>
            );
          })}
          {(!bedLayout || Object.keys(bedLayout).length === 0) && (
             <p className="text-center text-gray-500 ...">
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
  // ▼ selectedDate も AppContext から取得
  const { selectedFacility, selectedDate } = useContext(AppContext); 
  const [bedLayout, setBedLayout] = useState(null);
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [bedStatuses, setBedStatuses] = useState({});
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  
  // ▼ 日付と施設に基づいたベッド状態ドキュメントへの参照
  const statusDocRef = doc(db, 'bedStatuses', `${selectedFacility}_${selectedDate}`);
  const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);

  // --- 1. レイアウトの読み込み (AdminPageと同様) ---
  useEffect(() => {
    setLoadingLayout(true);
    const unsubscribeLayout = onSnapshot(layoutDocRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().positions) {
        setBedLayout(docSnap.data().positions);
      } else {
        setBedLayout({});
      }
      setLoadingLayout(false);
    }, (error) => {
      console.error("StaffPage: Error loading layout:", error);
      setBedLayout({});
      setLoadingLayout(false);
    });
    return () => unsubscribeLayout();
  }, [layoutDocRef]); // selectedFacility が変わると layoutDocRef が変わる

  // ▼--- 2. ベッド状態の読み込み (Firestore連携に修正) ---▼
  useEffect(() => {
     setLoadingStatuses(true);
     // AdminPageと同様に、ベッド状態ドキュメントをリアルタイムで監視
     const unsubscribeStatuses = onSnapshot(statusDocRef, (docSnap) => {
       if (docSnap.exists()) {
         setBedStatuses(docSnap.data());
         console.log("StaffPage: Bed statuses loaded/updated.");
       } else {
         // 基本的にAdminPageが初期化するはずだが、念のため
         setBedStatuses({});
         console.log("StaffPage: No status doc found. Waiting for admin to initialize.");
       }
       setLoadingStatuses(false);
     }, (error) => {
        console.error("StaffPage: Error loading bed statuses:", error);
        setLoadingStatuses(false);
     });

     return () => unsubscribeStatuses();
   }, [statusDocRef]); // selectedFacility や selectedDate が変わると statusDocRef が変わる

  // ▼--- 3. ベッドタップ時の処理 (Firestore連携に修正) ---▼
  const handleBedTap = async (bedNumber) => {
    const currentStatus = bedStatuses[bedNumber];
    
    // 「治療中」の場合のみ「準備完了」にできる
    if (currentStatus === '治療中') {
      console.log(`Staff tapped bed ${bedNumber}. Changing to 準備完了`);
      try {
        // Firestoreの該当ベッド番号のフィールドを「準備完了」に更新
        await updateDoc(statusDocRef, {
          [bedNumber]: "準備完了"
        });
      } catch (error) {
        console.error(`Error updating bed ${bedNumber}:`, error);
        alert('状態の更新に失敗しました。');
      }
    } else {
      console.log(`Bed ${bedNumber} tapped, but status is ${currentStatus}. No change.`);
    }
  };
  
  // --- 4. QRスキャン成功時の処理 (タスク9で実装予定) ---
  // ... (変更なし) ...

  // --- レンダリング ---
  if (loadingLayout || loadingStatuses) {
    return <LoadingSpinner text="ベッド情報とレイアウトを読み込み中..." />;
  }

  return (
    <div>
      {/* ... (QRスキャナ関連、タスク9で有効化) ... */}
      
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold text-gray-800">ベッド操作</h3>
            {/* ... (QRスキャンボタン、タスク9で有効化) ... */}
        </div>
        
        <div className="relative border border-gray-300 h-[600px] bg-gray-50 rounded-md overflow-hidden">
          {bedLayout && Object.keys(bedLayout).map((bedNumber) => {
            const position = bedLayout[bedNumber];
            // ▼ bedStatuses から最新の状態を取得
            const status = bedStatuses[bedNumber] || '治療中'; 
            const statusStyle = getBedStatusStyle(status);
            const isDisabled = status === '準備完了' || status === '連絡済'; // 既に通知済・連絡済なら押せない

            return (
              <button
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
                disabled={isDisabled} // 押せるかどうか
              >
                {bedNumber}
              </button>
            );
          })}
           {(!bedLayout || Object.keys(bedLayout).length === 0) && (
             <p className="text-center text-gray-500 ...">
               レイアウトが設定されていません。管理画面で設定してください。
             </p>
           )}
        </div>
      </div>
    </div>
  );
};


// --- ③ 親コンポーネント (タブ切り替え) ---
// (この部分は変更ありません)
const InpatientView = ({ user, onGoBack }) => {
  const [currentPage, setCurrentPage] = useState('staff'); 
  const NavButton = ({ page, label }) => ( /* ... */ );
  const renderPage = () => { /* ... */ };

  return (
    <AppLayout
      user={user}
      onGoBack={onGoBack}
      hideCoolSelector={true} 
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

