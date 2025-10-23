import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
// App.jsから主要コンポーネントと変数をインポート
// ▼ QrScannerModal もインポート
import { AppLayout, AppContext, db, LoadingSpinner, QrScannerModal } from '../App'; 
import LayoutEditor from './LayoutEditor.js'; // レイアウトエディタ
import BedButton from './BedButton.js'; // ベッドボタン
// Firestoreの関数: doc(参照作成), onSnapshot(リアルタイム監視), updateDoc(更新), setDoc(新規作成/上書き), getDoc(単一取得)
import { doc, onSnapshot, updateDoc, setDoc, getDoc } from 'firebase/firestore'; 

// --- 定数・ヘルパー関数 ---

// 入院透析室のベッド番号リスト（1〜20）
const inpatientBedNumbers = Array.from({ length: 20 }, (_, i) => String(i + 1));

/**
 * ベッドの状態（status）に応じてTailwind CSSのクラス名を返すヘルパー関数
 * @param {string} status - "治療中", "送迎可能", "連絡済"など
 * @returns {string} Tailwind CSSのクラス名
 */
const getBedStatusStyle = (status) => {
  switch (status) {
    case '送迎可能': // スタッフがタップした状態
      return 'bg-yellow-500 animate-pulse'; // 黄色点滅
    case '連絡済': // クラークがタップした状態
      return 'bg-gray-400 opacity-70'; // グレー
    case '治療中': // デフォルトの状態
    default:
      return 'bg-blue-500'; // 青
  }
};

// =====================================================================
// --- ① 管理画面コンポーネント (クラーク/モニター/レイアウト編集用) ---
// =====================================================================
const InpatientAdminPage = () => {
  const { selectedFacility, selectedDate } = useContext(AppContext); 
  const [isLayoutEditMode, setLayoutEditMode] = useState(false); // レイアウト編集モードか
  const [bedLayout, setBedLayout] = useState(null); // レイアウトデータ { "1": {top, left}, ... }
  const [loadingLayout, setLoadingLayout] = useState(true); // レイアウト読み込み中か
  const [bedStatuses, setBedStatuses] = useState({}); // ベッドの状態 { "1": "治療中", ... }
  const [loadingStatuses, setLoadingStatuses] = useState(true); // 状態読み込み中か

  // --- 音声通知（タスク8b）関連のRef ---
  const prevBedStatusesRef = useRef({}); // 1つ前のベッド状態を記憶
  const [isSpeaking, setIsSpeaking] = useState(false); // 現在、音声再生中か
  const speechQueueRef = useRef([]); // 読み上げ待機中のベッド番号キュー
  const currentAudioRef = useRef(null); // 現在再生中のAudioオブジェクト
  const nowPlayingRef = useRef(null);   // 現在再生中のベッド番号
  const nextSpeechTimerRef = useRef(null); // 次の再生までのタイマー

  // --- Firestoreドキュメント参照 ---
  // ベッド状態のドキュメント (例: bedStatuses/入院透析室_2025-10-23)
  const statusDocRef = doc(db, 'bedStatuses', `${selectedFacility}_${selectedDate}`);
  // レイアウトのドキュメント (例: bedLayouts/入院透析室)
  const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);

  // --- 1. レイアウトの読み込み (タスク7) ---
  // コンポーネント表示時、または施設が変更された時にレイアウトを読み込む
  useEffect(() => {
    setLoadingLayout(true);
    // onSnapshotを使い、レイアウトが変更されたらリアルタイムで反映
    const unsubscribeLayout = onSnapshot(layoutDocRef, (docSnap) => {
      if (docSnap.exists() && docSnap.data().positions) {
        setBedLayout(docSnap.data().positions); // Firestoreのデータをstateにセット
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
  }, [layoutDocRef]); // layoutDocRef (施設名) が変わったら再実行

  // --- 2. ベッド状態の読み込み (タスク8) ---
  // コンポーネント表示時、または施設・日付が変わった時にベッド状態を読み込む
  useEffect(() => {
     setLoadingStatuses(true);
     
     // onSnapshotを使い、ベッド状態の変更をリアルタイムで監視
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

     return () => unsubscribeStatuses(); // 監視を解除
   }, [statusDocRef]); // statusDocRef (施設名・日付) が変わったら再実行

  // --- 3. クラークさんによる状態リセット (タスク10) ---
  // 「送迎可能」状態のベッドをタップした（連絡が済んだ）ときの処理
  const handleBedReset = async (bedNumber) => {
    // 押されたベッドの状態が「送迎可能」の場合のみ実行
    if (bedStatuses[bedNumber] !== '送迎可能') return; 

    console.log(`Clerk reset bed ${bedNumber} to '連絡済'`);
    try {
      // Firestoreの該当ベッド番号のフィールドを「連絡済」に更新
      // [bedNumber] のようにキーを変数にする
      await updateDoc(statusDocRef, {
        [bedNumber]: "連絡済" 
      });
      // stateの更新は onSnapshot が自動的に検知して行うので、ここでは不要
    } catch (error) {
      console.error(`Error resetting bed ${bedNumber}:`, error);
      alert('状態の更新に失敗しました。');
    }
  };

  // --- 4. 音声通知機能 (タスク8b) ---

  // キューから次のベッド番号を取り出し、音声を再生する
  const speakNextInQueue = useCallback(() => {
    if (nextSpeechTimerRef.current) {
      clearTimeout(nextSpeechTimerRef.current);
      nextSpeechTimerRef.current = null;
    }
    // キューが空なら再生終了
    if (speechQueueRef.current.length === 0) {
      setIsSpeaking(false);
      nowPlayingRef.current = null;
      return;
    }

    setIsSpeaking(true);
    const bedNumber = speechQueueRef.current.shift(); // キューの先頭から取り出す
    nowPlayingRef.current = bedNumber;

    // 読み上げるテキスト
    const textToSpeak = `${bedNumber}番ベッド、送迎可能です。`;
    const functionUrl = "https://synthesizespeech-dewqhzsp5a-uc.a.run.app";

    // Cloud Function (音声合成API) を呼び出す
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
        audio.play(); // 再生
        audio.onended = () => {
          currentAudioRef.current = null;
          // 再生終了後、1秒待ってから次のキューへ
          nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
        };
      } else {
        throw new Error(data.error || 'Audio content not found');
      }
    })
    .catch((error) => {
      console.error("Speech synthesis failed:", error);
      currentAudioRef.current = null;
      // エラー時も1秒待ってから次へ
      nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
    });
  }, []); // 依存配列は空 (内部でstateやpropsに依存していないため)

  // ベッド状態(bedStatuses)の変化を監視し、音声キューを管理する
  useEffect(() => {
    const prevStatuses = prevBedStatusesRef.current; // 変更前の状態
    const currentStatuses = bedStatuses; // 最新の状態

    // 1. 新しく「送迎可能」になったベッドを特定
    const newReadyBeds = [];
    Object.keys(currentStatuses).forEach(bedNumber => {
      // 以前は「送迎可能」ではなく、現在「送迎可能」になったベッド
      if (currentStatuses[bedNumber] === '送迎可能' && prevStatuses[bedNumber] !== '送迎可能') {
        newReadyBeds.push(bedNumber);
      }
    });

    // 2. 新しく「送迎可能」になったベッドがあれば、キューに追加して再生開始
    if (newReadyBeds.length > 0) {
      console.log("Audio Queue: Adding new ready beds:", newReadyBeds);
      speechQueueRef.current.push(...newReadyBeds.sort((a, b) => a - b)); // 番号順にソートしてキューに追加
      if (!isSpeaking) {
        speakNextInQueue(); // 再生中でなければ再生開始
      }
    }

    // 3. 「送迎可能」から除外された（連絡済/治療中に戻された）ベッドを特定
    const cancelledBeds = new Set();
    Object.keys(prevStatuses).forEach(bedNumber => {
      if (prevStatuses[bedNumber] === '送迎可能' && currentStatuses[bedNumber] !== '送迎可能') {
        cancelledBeds.add(bedNumber);
      }
    });

    // 4. キャンセルされたベッドがあれば、キューや再生中の音声から削除・停止
    if (cancelledBeds.size > 0) {
      console.log("Audio Queue: Removing cancelled beds:", cancelledBeds);
      // 待機キューから削除
      speechQueueRef.current = speechQueueRef.current.filter(bedNum => !cancelledBeds.has(bedNum));
      
      // もし現在再生中のベッドがキャンセルされた場合、音声を即時停止
      if (nowPlayingRef.current && cancelledBeds.has(nowPlayingRef.current)) {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause(); // 音声停止
          currentAudioRef.current = null;
        }
        nowPlayingRef.current = null;
        if (nextSpeechTimerRef.current) {
          clearTimeout(nextSpeechTimerRef.current);
          nextSpeechTimerRef.current = null;
        }
        speakNextInQueue(); // 即座に次の再生を開始
      }
    }

    // 5. 今回の状態を「以前の状態」として保存
    prevBedStatusesRef.current = currentStatuses;

  }, [bedStatuses, isSpeaking, speakNextInQueue]); // bedStatusesが変わるたびに実行


  // --- レンダリング ---
  
  // レイアウト編集モードの場合
  if (isLayoutEditMode) {
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
          onClick={() => setLayoutEditMode(true)}
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
            const status = bedStatuses[bedNumber] || '治療中'; 
            const statusStyle = getBedStatusStyle(status);
            const isReady = status === '送迎可能';

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
                disabled={!isReady} // 「送迎可能」のベッドのみ操作可能
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
      
      {/* 音声再生中のインジケーター (印刷しない) */}
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


// =====================================================================
// --- ② スタッフ画面コンポーネント ---
// =====================================================================
const InpatientStaffPage = () => {
  const { selectedFacility, selectedDate } = useContext(AppContext); 
  const [bedLayout, setBedLayout] = useState(null);
  const [loadingLayout, setLoadingLayout] = useState(true);
  const [bedStatuses, setBedStatuses] = useState({});
  const [loadingStatuses, setLoadingStatuses] = useState(true);
  
  // ▼ QRスキャナ用のstate (タスク9)
  const [isScannerOpen, setScannerOpen] = useState(false);

  // Firestoreドキュメント参照
  const statusDocRef = doc(db, 'bedStatuses', `${selectedFacility}_${selectedDate}`);
  const layoutDocRef = doc(db, 'bedLayouts', selectedFacility);

  // --- 1. レイアウトの読み込み (AdminPageと同様) ---
  useEffect(() => {
    setLoadingLayout(true);
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
  }, [layoutDocRef]);

  // --- 2. ベッド状態の読み込み (AdminPageと同様) ---
  useEffect(() => {
     setLoadingStatuses(true);
     const unsubscribeStatuses = onSnapshot(statusDocRef, (docSnap) => {
       if (docSnap.exists()) {
         setBedStatuses(docSnap.data());
         console.log("StaffPage: Bed statuses loaded/updated.");
       } else {
         // 基本的にAdminPageが初期化するはず
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

  // --- 3. ベッドタップ時の処理 (タスク8) ---
  // スタッフがベッドをタップして「送迎可能」にする
  const handleBedTap = async (bedNumber) => {
    const currentStatus = bedStatuses[bedNumber];
    
    // 「治療中」の場合のみ「送迎可能」にできる
    if (currentStatus === '治療中') {
      console.log(`Staff tapped bed ${bedNumber}. Changing to 送迎可能`);
      try {
        // Firestoreの該当ベッド番号のフィールドを「送迎可能」に更新
        await updateDoc(statusDocRef, {
          [bedNumber]: "送迎可能"
        });
      } catch (error) {
        console.error(`Error updating bed ${bedNumber}:`, error);
        alert('状態の更新に失敗しました。');
      }
    } else {
      // 既に「送迎可能」または「連絡済」の場合は何もしない
      console.log(`Bed ${bedNumber} tapped, but status is ${currentStatus}. No change.`);
    }
  };
  
  // --- 4. QRスキャン成功時の処理 (タスク9) ---
  const handleScanSuccess = useCallback((scannedBedNumber) => {
    // スキャンされたテキストが、定義済みのベッド番号リストに含まれているか確認
    if (inpatientBedNumbers.includes(scannedBedNumber)) {
      console.log(`QR Scan success: ${scannedBedNumber}`);
      // ベッドタップ時と同じ処理（状態更新）を実行
      handleBedTap(scannedBedNumber); 
      return { success: true, message: `${scannedBedNumber}番ベッドを「送迎可能」にしました。` };
    } else {
      console.log(`QR Scan failed: Invalid bed number ${scannedBedNumber}`);
      return { success: false, message: `有効なベッド番号ではありません。（${scannedBedNumber}）` };
    }
    // handleBedTap が bedStatuses に依存しているため、bedStatuses を依存配列に追加
  }, [bedStatuses, statusDocRef]); // statusDocRefも念のため追加


  // --- レンダリング ---
  if (loadingLayout || loadingStatuses) {
    return <LoadingSpinner text="ベッド情報とレイアウトを読み込み中..." />;
  }

  return (
    <div>
      {/* ▼ QRスキャナモーダル (タスク9) ▼ */}
      {isScannerOpen && 
        <QrScannerModal 
          onClose={() => setScannerOpen(false)} 
          onScanSuccess={handleScanSuccess} 
        />
      }
      
      <div className="bg-white p-6 rounded-lg shadow">
        {/* ヘッダー：タイトルとQRスキャンボタン */}
        <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold text-gray-800">ベッド操作</h3>
            {/* ▼ QRスキャンボタン (タスク9) ▼ */}
            <button 
              onClick={() => setScannerOpen(true)}
              title="QRで呼び出し" 
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-3 rounded-lg transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button> 
        </div>
        
        {/* レイアウト表示エリア */}
        <div className="relative border border-gray-300 h-[600px] bg-gray-50 rounded-md overflow-hidden">
          {bedLayout && Object.keys(bedLayout).map((bedNumber) => {
            const position = bedLayout[bedNumber];
            const status = bedStatuses[bedNumber] || '治療中'; 
            const statusStyle = getBedStatusStyle(status);
            // 「送迎可能」または「連絡済」の場合はボタンを無効化
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
                onClick={() => handleBedTap(bedNumber)} // タップで状態更新
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


// =====================================================================
// --- ③ 親コンポーネント (タブ切り替え) ---
// =====================================================================
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

