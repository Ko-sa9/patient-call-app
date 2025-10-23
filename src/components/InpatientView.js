import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
// App.jsから主要コンポーネントと変数をインポート
import { AppLayout, AppContext, db, LoadingSpinner } from '../App'; 
import LayoutEditor from './LayoutEditor.js'; // レイアウトエディタ
import BedButton from './BedButton.js'; // ベッドボタン
import { doc, onSnapshot, updateDoc, setDoc, getDoc } from 'firebase/firestore'; 

// --- 定数・ヘルパー関数 ---
const inpatientBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

// ベッドの状態に応じたスタイルを返す関数
const getBedStatusStyle = (status) => {
  switch (status) {
    case '送迎可能': // ▼「準備完了」から「送迎可能」に変更
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
  const { selectedFacility, selectedDate } = useContext(AppContext); 
  const [isLayoutEditMode, setLayoutEditMode] = useState(false);
  const [bedLayout, setBedLayout] = useState(null); 
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [bedStatuses, setBedStatuses] = useState({}); 
  const [loadingStatuses, setLoadingStatuses] = useState(true); 

  const prevBedStatusesRef = useRef({}); 
  const [isSpeaking, setIsSpeaking] = useState(false); 
  const speechQueueRef = useRef([]); 
  const currentAudioRef = useRef(null); 
  const nowPlayingRef = useRef(null);   
  const nextSpeechTimerRef = useRef(null); 

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
  }, [layoutDocRef]);

  // --- 2. ベッド状態の読み込み (変更なし) ---
  useEffect(() => {
     setLoadingStatuses(true);
     const unsubscribeStatuses = onSnapshot(statusDocRef, async (docSnap) => {
       if (docSnap.exists()) {
         setBedStatuses(docSnap.data());
       } else {
         console.log("AdminPage: No status doc found. Initializing...");
         const initialStatuses = {};
         inpatientBedNumbers.forEach(num => {
           initialStatuses[num] = '治療中';
         });
         try {
           await setDoc(statusDocRef, initialStatuses); 
           setBedStatuses(initialStatuses);
         } catch (error) {
           console.error("Error initializing bed statuses:", error);
         }
       }
       setLoadingStatuses(false);
     }, (error) => {
        console.error("AdminPage: Error loading bed statuses:", error);
        setLoadingStatuses(false);
     });
     return () => unsubscribeStatuses();
   }, [statusDocRef]);

  // --- 3. クラークさんによる状態リセット ---
  const handleBedReset = async (bedNumber) => {
    // ▼「送迎可能」の場合のみ実行
    if (bedStatuses[bedNumber] !== '送迎可能') return; 
    console.log(`Clerk reset bed ${bedNumber}`);
    try {
      await updateDoc(statusDocRef, {
        [bedNumber]: "連絡済" 
      });
    } catch (error) {
      console.error(`Error resetting bed ${bedNumber}:`, error);
      alert('状態の更新に失敗しました。');
    }
  };

  // --- 4. 音声通知機能 ---

  // キューから次のベッド番号を取り出し、音声を再生する
  const speakNextInQueue = useCallback(() => {
    if (nextSpeechTimerRef.current) {
      clearTimeout(nextSpeechTimerRef.current);
      nextSpeechTimerRef.current = null;
    }
    if (speechQueueRef.current.length === 0) {
      setIsSpeaking(false);
      nowPlayingRef.current = null;
      return;
    }

    setIsSpeaking(true);
    const bedNumber = speechQueueRef.current.shift();
    nowPlayingRef.current = bedNumber;

    // ▼ 読み上げるテキストを「送迎可能」に変更
    const textToSpeak = `${bedNumber}番ベッド、送迎可能です。`;
    const functionUrl = "https://synthesizespeech-dewqhzsp5a-uc.a.run.app";

    fetch(functionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textToSpeak }),
    })
    .then(res => res.json())
    .then(data => {
      if (data.audioContent) {
        const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
        currentAudioRef.current = audio;
        audio.play();
        audio.onended = () => {
          currentAudioRef.current = null;
          nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
        };
      } else {
        throw new Error(data.error || 'Audio content not found');
      }
    })
    .catch((error) => {
      console.error("Speech synthesis failed:", error);
      currentAudioRef.current = null;
      nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
    });
  }, []); // 依存配列は空

  // ベッド状態(bedStatuses)の変化を監視し、音声キューを管理する
  useEffect(() => {
    const prevStatuses = prevBedStatusesRef.current;
    const currentStatuses = bedStatuses;

    // 1. 新しく「送迎可能」になったベッドを特定し、キューに追加
    const newReadyBeds = [];
    Object.keys(currentStatuses).forEach(bedNumber => {
      // ▼「送迎可能」に変更
      if (currentStatuses[bedNumber] === '送迎可能' && prevStatuses[bedNumber] !== '送迎可能') {
        newReadyBeds.push(bedNumber);
      }
    });

    if (newReadyBeds.length > 0) {
      console.log("Audio Queue: Adding new ready beds:", newReadyBeds);
      speechQueueRef.current.push(...newReadyBeds.sort((a, b) => a - b)); 
      if (!isSpeaking) {
        speakNextInQueue();
      }
    }

    // 2. 「送迎可能」から除外されたベッドを特定
    const cancelledBeds = new Set();
    Object.keys(prevStatuses).forEach(bedNumber => {
       // ▼「送迎可能」に変更
      if (prevStatuses[bedNumber] === '送迎可能' && currentStatuses[bedNumber] !== '送迎可能') {
        cancelledBeds.add(bedNumber);
      }
    });

    if (cancelledBeds.size > 0) {
      console.log("Audio Queue: Removing cancelled beds:", cancelledBeds);
      // 3. 待機キューからキャンセルされたベッドを削除
      speechQueueRef.current = speechQueueRef.current.filter(bedNum => !cancelledBeds.has(bedNum));
      
      // 4. もし現在再生中のベッドがキャンセルされた場合、音声を即時停止
      if (nowPlayingRef.current && cancelledBeds.has(nowPlayingRef.current)) {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current = null;
        }
        nowPlayingRef.current = null;
        if (nextSpeechTimerRef.current) {
          clearTimeout(nextSpeechTimerRef.current);
          nextSpeechTimerRef.current = null;
        }
        speakNextInQueue();
      }
    }

    // 5. 今回の状態を「以前の状態」として保存
    prevBedStatusesRef.current = currentStatuses;

  }, [bedStatuses, isSpeaking, speakNextInQueue]);


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
      {/* レイアウト編集ボタン (変更なし) */}
      <div className="bg-white p-6 rounded-lg shadow mb-6 no-print">
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
            const status = bedStatuses[bedNumber] || '治療中'; 
            const statusStyle = getBedStatusStyle(status);
             // ▼「送迎可能」に変更
            const isReady = status === '送迎可能';

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
                onClick={() => handleBedReset(bedNumber)}
                disabled={!isReady} // ▼「送迎可能」のベッドのみ操作可能
              >
                {bedNumber}
              </button>
            );
          })}
          {(!bedLayout || Object.keys(bedLayout).length === 0) && (
             <p className="text-center text-gray-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
               レイアウトが設定されていません。「レイアウト設定」から配置してください。
             </p>
           )}
        </div>
      </div>
      
      {/* 音声再生中のインジケーター (変更なし) */}
      {isSpeaking && 
        <div className="fixed bottom-5 right-5 bg-yellow-400 text-black font-bold py-2 px-4 rounded-full shadow-lg flex items-center no-print">
          <svg className="animate-spin h-5 w-5 mr-3" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          音声再生中...
        </div>
      }
    </div>
  );
};


// --- ② スタッフ画面コンポーネント ---
const InpatientStaffPage = () => {
  const { selectedFacility, selectedDate } = useContext(AppContext); 
  const [bedLayout, setBedLayout] = useState(null);
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [bedStatuses, setBedStatuses] = useState({});
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  
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
      console.error("StaffPage: Error loading layout:", error);
      setBedLayout({});
      setLoadingLayout(false);
    });
    return () => unsubscribeLayout();
  }, [layoutDocRef]);

  // --- 2. ベッド状態の読み込み (変更なし) ---
  useEffect(() => {
     setLoadingStatuses(true);
     const unsubscribeStatuses = onSnapshot(statusDocRef, (docSnap) => {
       if (docSnap.exists()) {
         setBedStatuses(docSnap.data());
       } else {
         setBedStatuses({});
         console.log("StaffPage: No status doc found. Waiting for admin to initialize.");
       }
       setLoadingStatuses(false);
     }, (error) => {
        console.error("StaffPage: Error loading bed statuses:", error);
        setLoadingStatuses(false);
     });

     return () => unsubscribeStatuses();
   }, [statusDocRef]);

  // ▼--- 3. ベッドタップ時の処理 (Firestore連携に修正) ---▼
  const handleBedTap = async (bedNumber) => {
    const currentStatus = bedStatuses[bedNumber];
    
    // 「治療中」の場合のみ「送迎可能」にできる
    if (currentStatus === '治療中') {
      console.log(`Staff tapped bed ${bedNumber}. Changing to 送迎可能`);
      try {
        // ▼「送迎可能」に更新
        await updateDoc(statusDocRef, {
          [bedNumber]: "送迎可能"
        });
      } catch (error) {
        console.error(`Error updating bed ${bedNumber}:`, error);
        alert('状態の更新に失敗しました。');
      }
    } else {
      console.log(`Bed ${bedNumber} tapped, but status is ${currentStatus}. No change.`);
    }
  };
  
  // ... (タスク9 QRスキャンはまだ) ...

  // --- レンダリング (変更なし) ---
  if (loadingLayout || loadingStatuses) {
    return <LoadingSpinner text="ベッド情報とレイアウトを読み込み中..." />;
  }

  return (
    <div>
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold text-gray-800">ベッド操作</h3>
        </div>
        
        <div className="relative border border-gray-300 h-[600px] bg-gray-50 rounded-md overflow-hidden">
          {bedLayout && Object.keys(bedLayout).map((bedNumber) => {
            const position = bedLayout[bedNumber];
            const status = bedStatuses[bedNumber] || '治療中'; 
            const statusStyle = getBedStatusStyle(status);
            // ▼「送迎可能」に変更
            const isDisabled = status === '送迎可能' || status === '連絡済'; 

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
                onClick={() => handleBedTap(bedNumber)}
                disabled={isDisabled}
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
// (変更なし)
const InpatientView = ({ user, onGoBack }) => {
  const [currentPage, setCurrentPage] = useState('staff'); 
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

  const renderPage = () => {
    switch (currentPage) {
      case 'admin':
        return <InpatientAdminPage />;
      case 'staff':
        return <InpatientStaffPage />;
      default:
        return <InpatientStaffPage />;
    }
  };

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

