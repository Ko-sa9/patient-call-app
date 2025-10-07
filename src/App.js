import React, { useState, useEffect, createContext, useContext, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, query, where, addDoc, getDocs, deleteDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import * as wanakana from 'wanakana';

// --- Firebase Configuration ---
// Firebaseプロジェクトの設定情報。環境変数からAPIキーを読み込むことで、セキュリティを向上させている。
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY, // Netlifyの環境変数から安全に読み込み
  authDomain: "patient-call-app-f5e7f.firebaseapp.com",
  projectId: "patient-call-app-f5e7f",
  storageBucket: "patient-call-app-f5e7f.appspot.com",
  messagingSenderId: "545799005149",
  appId: "1:545799005149:web:f1b22a42040eb455e98c34"
};

// --- Initialize Firebase ---
// Firebaseの各サービスを初期化し、アプリ全体で利用できるようにする。
const app = initializeApp(firebaseConfig);
const auth = getAuth(app); // 認証サービス
const db = getFirestore(app); // Firestoreデータベース
const functions = getFunctions(app, 'us-central1'); // Cloud Functions（音声合成などで使用）

// --- Helper Components & Functions ---

// 日本標準時(JST)での今日の日付を 'YYYY-MM-DD' 形式の文字列で取得する。
const getTodayString = () => {
    const today = new Date();
    today.setHours(today.getHours() + 9); // JSTに変換
    return today.toISOString().split('T')[0];
}

// 日付文字列から曜日を判定し、'月水金' または '火木土' の文字列を返す。日曜日はnull。
// 患者マスタから特定の曜日の患者を読み込む際に使用する。
const getDayQueryString = (dateString) => {
    const date = new Date(dateString);
    const dayIndex = date.getDay(); // 0:日曜, 1:月曜, ...
    if ([1, 3, 5].includes(dayIndex)) return '月水金';
    if ([2, 4, 6].includes(dayIndex)) return '火木土';
    return null; // 日曜など
};

// ローディング中に表示するスピナーコンポーネント。
const LoadingSpinner = ({ text = "読み込み中..." }) => (
    <div className="flex flex-col justify-center items-center h-full my-8">
        <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500"></div>
        <p className="mt-4 text-gray-600">{text}</p>
    </div>
);

// 汎用的なモーダルUIコンポーネント。
const CustomModal = ({ title, children, onClose, footer }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
        <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg">
            <div className="flex justify-between items-center border-b pb-3 mb-4">
                <h3 className="text-xl font-bold">{title}</h3>
                {onClose && <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-2xl">&times;</button>}
            </div>
            <div className="mb-6">{children}</div>
            {footer && <div className="border-t pt-4 flex justify-end space-x-3">{footer}</div>}
        </div>
    </div>
);

// 確認ダイアログ用のモーダルコンポーネント。削除操作などで使用。
const ConfirmationModal = ({ title, message, onConfirm, onCancel, confirmText = "実行", confirmColor = "blue" }) => (
     <CustomModal 
        title={title} 
        onClose={onCancel} 
        footer={
            <>
                <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">
                    キャンセル
                </button>
                <button onClick={onConfirm} className={`font-bold py-2 px-6 rounded-lg transition text-white ${confirmColor === 'red' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                    {confirmText}
                </button>
            </>
        }
    >
        <p>{message}</p>
    </CustomModal>
);

// --- App Context for Shared State ---
// アプリ全体で共有する状態（選択中の施設、日付、クール）を管理するためのContext。
const AppContext = createContext();
const FACILITIES = ["本院透析室", "坂田透析棟", "じんクリニック", "木更津クリニック"]; // 施設リスト

// --- Custom Hooks ---

// 特定の施設・日付・クールの「本日のリスト」をFirestoreから取得し、リアルタイムで更新するカスタムフック。
const useDailyList = () => {
    const { selectedFacility, selectedDate, selectedCool } = useContext(AppContext);
    const [dailyList, setDailyList] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 依存する値がなければ何もしない
        if (!selectedFacility || !selectedDate || !selectedCool) {
            setLoading(false);
            return;
        }
        setLoading(true);
        // FirestoreのドキュメントIDを生成
        const dailyListId = `${selectedDate}_${selectedFacility}_${selectedCool}`;
        const dailyPatientsCollectionRef = collection(db, 'daily_lists', dailyListId, 'patients');
        
        const q = query(dailyPatientsCollectionRef);

        // onSnapshotでデータの変更をリアルタイムに監視
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedDailyPatients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), cool: selectedCool }));
            setDailyList(fetchedDailyPatients);
            setLoading(false);
        }, (err) => {
            console.error("Daily list fetch error:", err);
            setLoading(false);
        });
        
        // コンポーネントがアンマウントされる際に監視を解除
        return () => unsubscribe();
    }, [selectedFacility, selectedDate, selectedCool]); // 依存配列

    return { dailyList, loading };
};

// 特定の施設・日付における全クール（1, 2, 3）の患者リストをまとめて取得するカスタムフック。
// モニター画面やスタッフ画面など、クールを横断して情報を表示する画面で使用する。
const useAllDayPatients = () => {
    const { selectedFacility, selectedDate } = useContext(AppContext);
    const [allPatients, setAllPatients] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!selectedFacility || !selectedDate) {
            setLoading(false);
            return;
        }
        setLoading(true);

        const cools = ['1', '2', '3'];
        const unsubscribes = [];
        let patientData = { '1': [], '2': [], '3': [] }; // 各クールのデータを保持
        let loadedFlags = { '1': false, '2': false, '3': false }; // 各クールの読み込み完了フラグ

        // 全クールのデータを結合してstateを更新する関数
        const updateCombinedList = () => {
            const combined = Object.values(patientData).flat();
            setAllPatients(combined);
        };
        
        // 全てのクールの読み込みが完了したかチェックする関数
        const checkLoadingDone = () => {
            if (Object.values(loadedFlags).every(flag => flag)) {
                setLoading(false);
            }
        };

        // 各クールに対して、onSnapshotリスナーを設定
        cools.forEach(cool => {
            const dailyListId = `${selectedDate}_${selectedFacility}_${cool}`;
            const dailyPatientsCollectionRef = collection(db, 'daily_lists', dailyListId, 'patients');
            const q = query(dailyPatientsCollectionRef);

            const unsubscribe = onSnapshot(q, (snapshot) => {
                patientData[cool] = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), cool: cool }));
                updateCombinedList();
                if (!loadedFlags[cool]) {
                    loadedFlags[cool] = true;
                    checkLoadingDone();
                }
            }, (err) => {
                console.error(`Error fetching list for cool ${cool}:`, err);
                patientData[cool] = []; // エラー時は空にする
                updateCombinedList();
                 if (!loadedFlags[cool]) {
                    loadedFlags[cool] = true;
                    checkLoadingDone();
                }
            });
            unsubscribes.push(unsubscribe);
        });

        // コンポーネントのアンマウント時に全てのリスナーを解除
        return () => {
            unsubscribes.forEach(unsub => unsub());
        };
    }, [selectedFacility, selectedDate]);

    return { allPatients, loading };
};

// --- Status Update Function ---

// 患者のステータス（治療中, 呼出中, 退出済）をFirestore上で更新する非同期関数。
const updatePatientStatus = async (facility, date, cool, patientId, newStatus) => {
    const dailyListId = `${date}_${facility}_${cool}`;
    const patientDocRef = doc(db, 'daily_lists', dailyListId, 'patients', patientId);
    try {
        await updateDoc(patientDocRef, {
            status: newStatus,
            updatedAt: serverTimestamp() // 更新日時を記録
        });
    } catch (error) {
        console.error("Error updating status: ", error);
        alert("ステータスの更新に失敗しました。");
    }
};

// 患者のステータスに応じて色分けされたバッジを表示するUIコンポーネント。
const StatusBadge = ({ status }) => {
    const statusStyles = {
        '治療中': 'bg-green-200 text-green-800',
        '呼出中': 'bg-blue-200 text-blue-800',
        '退出済': 'bg-gray-500 text-white',
    };
    return <span className={`text-xs font-semibold mr-2 px-2.5 py-0.5 rounded-full ${statusStyles[status] || 'bg-gray-200'}`}>{status}</span>;
};


// --- Page Components ---

// --- 1. Admin Page ---
// 必須項目を示すバッジ
const RequiredBadge = () => <span className="ml-2 bg-red-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">必須</span>;

// 管理者向けページ。患者マスタの管理と、その日の呼び出しリストの作成・編集を行う。
const AdminPage = () => {
    // --- State & Context ---
    const { selectedFacility, selectedDate, selectedCool } = useContext(AppContext);
    const { dailyList, loading: loadingDaily } = useDailyList(); // 本日のリスト

    // 患者マスタ関連のstate
    const [masterPatients, setMasterPatients] = useState([]); // マスタ患者リスト
    const [loadingMaster, setLoadingMaster] = useState(true); // マスタ読み込み状態
    const [masterModalOpen, setMasterModalOpen] = useState(false); // マスタ編集モーダルの開閉
    const [editingMasterPatient, setEditingMasterPatient] = useState(null); // 編集中のマスタ患者情報
    
    // マスタ登録/編集フォームのstate
    const initialMasterFormData = { patientId: '', lastName: '', firstName: '', furigana: '', bed: '', day: '月水金', cool: '1' };
    const [masterFormData, setMasterFormData] = useState(initialMasterFormData);
    
    // ふりがな自動入力関連のstate
    const [furiganaParts, setFuriganaParts] = useState({ last: '', first: '' });
    const isFuriganaManuallyEdited = useRef(false); // ふりがなが手動編集されたかのフラグ
    const [formError, setFormError] = useState(''); // フォームのエラーメッセージ
    const [masterSearchTerm, setMasterSearchTerm] = useState(''); // マスタ検索キーワード
    
    // 臨時患者追加モーダル関連のstate
    const [addDailyModalOpen, setAddDailyModalOpen] = useState(false);
    const [dailyModalMode, setDailyModalMode] = useState('search'); // 'search' or 'manual'
    const [tempPatientSearchTerm, setTempPatientSearchTerm] = useState('');
    const initialDailyFormData = { lastName: '', firstName: '', furigana: '', bed: '' };
    const [dailyFormData, setDailyFormData] = useState(initialDailyFormData);
    const [dailyFuriganaParts, setDailyFuriganaParts] = useState({ last: '', first: '' });
    const isDailyFuriganaManual = useRef(false);
    
    // 本日のリスト患者編集モーダル関連のstate
    const [editDailyModalOpen, setEditDailyModalOpen] = useState(false);
    const [editingDailyPatient, setEditingDailyPatient] = useState(null);
    const [editDailyFormData, setEditDailyFormData] = useState({ lastName: '', firstName: '', furigana: '', bed: '' });
    const [editFuriganaParts, setEditFuriganaParts] = useState({ last: '', first: '' });
    const isEditFuriganaManual = useRef(false);

    // 確認モーダル関連のstate
    const [confirmMasterDelete, setConfirmMasterDelete] = useState({ isOpen: false, patientId: null });
    const [confirmDailyDelete, setConfirmDailyDelete] = useState({ isOpen: false, patientId: null });
    const [confirmLoadModal, setConfirmLoadModal] = useState({isOpen: false, onConfirm: () => {}});
    const [confirmClearListModal, setConfirmClearListModal] = useState({ isOpen: false });

    // --- Firestore References ---
    const masterPatientsCollectionRef = collection(db, 'patients');
    const dailyPatientsCollectionRef = (cool) => collection(db, 'daily_lists', `${selectedDate}_${selectedFacility}_${cool}`, 'patients');

    // --- Effects ---
    // 選択された施設に応じて患者マスタをFirestoreから取得する
    useEffect(() => {
        setLoadingMaster(true);
        const q = query(masterPatientsCollectionRef, where("facility", "==", selectedFacility));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const patientsData = snapshot.docs.map(doc => {
                const data = doc.data();
                // 過去のデータ構造（nameフィールドのみ）との互換性を保つ
                let lastName = data.lastName || '';
                let firstName = data.firstName || '';
                let name = '';
                if (lastName || firstName) { name = `${lastName} ${firstName}`.trim(); } 
                else if (data.name) {
                    name = data.name;
                    const nameParts = data.name.split(/[\s　]+/);
                    lastName = nameParts[0] || '';
                    firstName = nameParts.slice(1).join(' ') || '';
                }
                return { id: doc.id, ...data, name, lastName, firstName };
            });
            setMasterPatients(patientsData);
            setLoadingMaster(false);
        }, (err) => {
            console.error("Master patient fetch error:", err);
            setLoadingMaster(false);
        });
        return () => unsubscribe();
    }, [selectedFacility]);
    
    // 姓名のふりがなパーツが変更されたら、結合してフォームデータにセットする（マスタ用）
    useEffect(() => {
        if (isFuriganaManuallyEdited.current) return; // 手動編集時は何もしない
        const combinedFurigana = [furiganaParts.last, furiganaParts.first].filter(Boolean).join(' ');
        setMasterFormData(prev => ({ ...prev, furigana: combinedFurigana }));
    }, [furiganaParts]);
    
    // 姓名のふりがなパーツが変更されたら、結合してフォームデータにセットする（臨時患者用）
    useEffect(() => {
        if (isDailyFuriganaManual.current) return;
        const combinedFurigana = [dailyFuriganaParts.last, dailyFuriganaParts.first].filter(Boolean).join(' ');
        setDailyFormData(prev => ({ ...prev, furigana: combinedFurigana }));
    }, [dailyFuriganaParts]);
    
    // 姓名のふりがなパーツが変更されたら、結合してフォームデータにセットする（リスト編集用）
    useEffect(() => {
        if (isEditFuriganaManual.current) return;
        const combinedFurigana = [editFuriganaParts.last, editFuriganaParts.first].filter(Boolean).join(' ');
        setEditDailyFormData(prev => ({ ...prev, furigana: combinedFurigana }));
    }, [editFuriganaParts]);

    // --- Modal Handlers ---
    // 患者マスタの登録・編集モーダルを開く
    const handleOpenMasterModal = (patient = null) => {
        setEditingMasterPatient(patient);
        isFuriganaManuallyEdited.current = false;
        setFormError('');
        if (patient) { // 編集の場合
            setMasterFormData({ 
                patientId: patient.patientId || '', lastName: patient.lastName || '',
                firstName: patient.firstName || '', furigana: patient.furigana || '', 
                bed: patient.bed, day: patient.day, cool: patient.cool 
            });
            if(patient.furigana) { isFuriganaManuallyEdited.current = true; } // 既存のふりがなは手動扱い
            setFuriganaParts({ last: '', first: '' });
        } else { // 新規登録の場合
            setMasterFormData(initialMasterFormData);
            setFuriganaParts({ last: '', first: '' });
        }
        setMasterModalOpen(true);
    };
    
    // 患者マスタモーダルを閉じる
    const handleCloseMasterModal = () => { setMasterModalOpen(false); };
    
    // --- Form Handlers ---
    // 患者マスタフォームの入力値をハンドルする
    const handleMasterFormChange = (e) => {
        const { name, value } = e.target;
        setFormError('');

        // ふりがなフィールドが直接編集された場合、手動編集フラグを立てる
        if (name === 'furigana') {
            isFuriganaManuallyEdited.current = true;
            setMasterFormData(prev => ({ ...prev, furigana: value }));
            return;
        }

        // 姓名がクリアされた場合、ふりがな自動入力を再度有効にする
        const isClearingName = (name === 'lastName' && value === '' && masterFormData.firstName === '') ||
                               (name === 'firstName' && value === '' && masterFormData.lastName === '');
        if (isClearingName) {
            isFuriganaManuallyEdited.current = false;
        }

        setMasterFormData(prev => ({ ...prev, [name]: value }));

        // ふりがなが手動編集されていなければ、姓名からふりがなを自動生成
        if (!isFuriganaManuallyEdited.current) {
            if (name === 'lastName') {
                if (wanakana.isKana(value)) { setFuriganaParts(prev => ({ ...prev, last: wanakana.toHiragana(value) })); }
            } else if (name === 'firstName') {
                if (wanakana.isKana(value)) { setFuriganaParts(prev => ({ ...prev, first: wanakana.toHiragana(value) })); }
            }
        }
    };

    // 患者マスタフォームの送信処理
    const handleMasterSubmit = async (e) => { 
        e.preventDefault(); 
        // バリデーション
        if (!masterFormData.lastName || !masterFormData.firstName || !masterFormData.bed || !masterFormData.patientId) {
            setFormError('必須項目をすべて入力してください。');
            return; 
        }
        const dataToSave = {
            patientId: masterFormData.patientId, lastName: masterFormData.lastName,
            firstName: masterFormData.firstName, furigana: masterFormData.furigana,
            bed: masterFormData.bed, day: masterFormData.day,
            cool: masterFormData.cool, facility: selectedFacility,
        };
        try { 
            if (editingMasterPatient) { // 編集モード
                await updateDoc(doc(masterPatientsCollectionRef, editingMasterPatient.id), { ...dataToSave, updatedAt: serverTimestamp() }); 
            } else { // 新規登録モード
                await addDoc(masterPatientsCollectionRef, { ...dataToSave, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); 
            } 
            handleCloseMasterModal(); 
        } catch (error) { 
            console.error("Error saving master patient:", error); 
            setFormError('保存中にエラーが発生しました。');
        } 
    };
    
    // 臨時患者追加モーダルを開く
    const handleOpenAddDailyModal = () => {
        setDailyModalMode('search'); // 初期タブは「マスタから検索」
        setTempPatientSearchTerm('');
        setDailyFormData(initialDailyFormData);
        setDailyFuriganaParts({ last: '', first: '' });
        isDailyFuriganaManual.current = false;
        setFormError('');
        setAddDailyModalOpen(true);
    };

    // 臨時患者追加モーダルを閉じる
    const handleCloseAddDailyModal = () => setAddDailyModalOpen(false);

    // 臨時患者（手動登録）フォームの入力値をハンドルする
    const handleDailyFormChange = (e) => {
        const { name, value } = e.target;
        setFormError('');

        if (name === 'furigana') {
            isDailyFuriganaManual.current = true;
            setDailyFormData(prev => ({ ...prev, furigana: value }));
            return;
        }

        const isClearingName = (name === 'lastName' && value === '' && dailyFormData.firstName === '') ||
                               (name === 'firstName' && value === '' && dailyFormData.lastName === '');
        if (isClearingName) {
            isDailyFuriganaManual.current = false;
        }

        setDailyFormData(prev => ({ ...prev, [name]: value }));

        if (!isDailyFuriganaManual.current) {
            if (name === 'lastName') {
                if (wanakana.isKana(value)) { setDailyFuriganaParts(prev => ({ ...prev, last: wanakana.toHiragana(value) })); }
            } else if (name === 'firstName') {
                if (wanakana.isKana(value)) { setDailyFuriganaParts(prev => ({ ...prev, first: wanakana.toHiragana(value) })); }
            }
        }
    };

    // マスタから選択して臨時患者を本日のリストに追加する
    const handleAddTempFromMaster = async (patient) => {
        try {
            await addDoc(dailyPatientsCollectionRef(selectedCool), {
                name: patient.name, furigana: patient.furigana || '', bed: patient.bed,
                status: '治療中', isTemporary: true, // 臨時フラグ
                masterPatientId: patient.patientId, // マスタの患者IDを紐付け
                masterDocId: patient.id, // マスタのドキュメントIDを紐付け
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            handleCloseAddDailyModal();
        } catch (error) {
            console.error("Error adding temporary patient from master:", error);
            setFormError('臨時患者の追加に失敗しました。');
        }
    };

    // 手動入力で臨時患者を本日のリストに追加する
    const handleAddDailySubmit = async (e) => {
        e.preventDefault();
        if (!dailyFormData.lastName || !dailyFormData.firstName || !dailyFormData.bed) {
            setFormError('必須項目をすべて入力してください。');
            return;
        }
        try {
            await addDoc(dailyPatientsCollectionRef(selectedCool), {
                name: `${dailyFormData.lastName} ${dailyFormData.firstName}`.trim(),
                furigana: dailyFormData.furigana, bed: dailyFormData.bed,
                status: '治療中', isTemporary: true, // 臨時フラグ
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            handleCloseAddDailyModal();
        } catch (error) { 
            console.error("Error saving daily patient:", error);
            setFormError('臨時患者の保存に失敗しました。');
        }
    };
    
    // 本日のリストの患者編集モーダルを開く
    const handleOpenEditDailyModal = (patient) => {
        const nameParts = (patient.name || '').split(/[\s　]+/);
        const lastName = nameParts[0] || '';
        const firstName = nameParts.slice(1).join(' ') || '';

        setEditingDailyPatient(patient);
        setEditDailyFormData({ lastName, firstName, furigana: patient.furigana || '', bed: patient.bed });
        setEditFuriganaParts({ last: '', first: '' });
        isEditFuriganaManual.current = !!patient.furigana;
        setFormError('');
        setEditDailyModalOpen(true);
    };

    // 本日のリストの患者編集モーダルを閉じる
    const handleCloseEditDailyModal = () => {
        setEditDailyModalOpen(false);
        setEditingDailyPatient(null);
    };

    // 本日のリストの患者編集フォームの入力値をハンドルする
    const handleEditDailyFormChange = (e) => {
        const { name, value } = e.target;
        setFormError('');

        if (name === 'furigana') {
            isEditFuriganaManual.current = true;
            setEditDailyFormData(prev => ({ ...prev, furigana: value }));
            return;
        }

        const isClearingName = (name === 'lastName' && value === '' && editDailyFormData.firstName === '') ||
                               (name === 'firstName' && value === '' && editDailyFormData.lastName === '');
        if (isClearingName) {
            isEditFuriganaManual.current = false;
        }

        setEditDailyFormData(prev => ({ ...prev, [name]: value }));

        if (!isEditFuriganaManual.current) {
            if (name === 'lastName') {
                if (wanakana.isKana(value)) { setEditFuriganaParts(prev => ({ ...prev, last: wanakana.toHiragana(value) })); }
            } else if (name === 'firstName') {
                if (wanakana.isKana(value)) { setEditFuriganaParts(prev => ({ ...prev, first: wanakana.toHiragana(value) })); }
            }
        }
    };

    // 本日のリストの患者編集フォームの送信処理
    const handleEditDailySubmit = async (e) => {
        e.preventDefault();
        if (!editDailyFormData.lastName || !editDailyFormData.firstName || !editDailyFormData.bed) {
            setFormError('必須項目をすべて入力してください。');
            return;
        }
        if (!editingDailyPatient) return;

        try {
            const docRef = doc(dailyPatientsCollectionRef(selectedCool), editingDailyPatient.id);
            await updateDoc(docRef, {
                name: `${editDailyFormData.lastName} ${editDailyFormData.firstName}`.trim(),
                furigana: editDailyFormData.furigana,
                bed: editDailyFormData.bed,
                updatedAt: serverTimestamp(),
            });
            handleCloseEditDailyModal();
        } catch (error) {
            console.error("Error updating daily patient:", error);
            setFormError('更新中にエラーが発生しました。');
        }
    };

    // --- Delete Handlers ---
    // マスタからの削除ボタンクリック時の処理
    const handleDeleteMasterClick = (patientId) => setConfirmMasterDelete({ isOpen: true, patientId });
    // マスタからの削除確認モーダルで「削除」を押したときの処理
    const handleConfirmMasterDelete = async () => { if (confirmMasterDelete.patientId) { try { await deleteDoc(doc(masterPatientsCollectionRef, confirmMasterDelete.patientId)); } catch (error) { console.error("Error deleting master patient:", error); } setConfirmMasterDelete({ isOpen: false, patientId: null }); } };
    
    // 本日のリストからの削除ボタンクリック時の処理
    const handleDeleteDailyClick = (patientId) => setConfirmDailyDelete({ isOpen: true, patientId });
    // 本日のリストからの削除確認モーダルで「削除」を押したときの処理
    const handleConfirmDailyDelete = async () => { if (confirmDailyDelete.patientId) { try { await deleteDoc(doc(dailyPatientsCollectionRef(selectedCool), confirmDailyDelete.patientId)); } catch (error) { console.error("Error deleting daily patient:", error); } setConfirmDailyDelete({ isOpen: false, patientId: null }); } };

    // --- Main Actions ---
    // 患者マスタから、その日の対象患者を「本日のリスト」に一括で読み込む
    const handleLoadPatients = async () => {
        const dayQuery = getDayQueryString(selectedDate);
        if (!dayQuery) { alert("日曜日は対象外です。"); return; }
        
        const loadAction = async () => {
            setLoadingMaster(true);
            try {
                // 施設・曜日・クールでマスタから患者を絞り込むクエリ
                const q = query(masterPatientsCollectionRef, where("facility", "==", selectedFacility), where("day", "==", dayQuery), where("cool", "==", selectedCool));
                const masterSnapshot = await getDocs(q);
                if (masterSnapshot.empty) { alert("対象となる患者さんがマスタに登録されていません。"); setLoadingMaster(false); return; }
                
                // writeBatchを使って複数の書き込みをアトミックに行う
                const batch = writeBatch(db);
                const dailyListId = `${selectedDate}_${selectedFacility}_${selectedCool}`;
                const listDocRef = doc(db, 'daily_lists', dailyListId);
                // daily_lists/{listId} ドキュメント自体も作成/更新
                batch.set(listDocRef, { createdAt: serverTimestamp(), facility: selectedFacility, date: selectedDate, cool: selectedCool });
                
                masterSnapshot.forEach(patientDoc => {
                    const patientData = patientDoc.data();
                    const patientName = `${patientData.lastName || ''} ${patientData.firstName || ''}`.trim() || patientData.name || '';
                    const newDailyPatientDocRef = doc(dailyPatientsCollectionRef(selectedCool)); 
                    batch.set(newDailyPatientDocRef, { 
                        name: patientName, furigana: patientData.furigana || '', 
                        bed: patientData.bed, status: '治療中', 
                        masterPatientId: patientData.patientId || null,
                        masterDocId: patientDoc.id,
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                    });
                });
                await batch.commit(); // バッチ処理を実行
            } catch (error) { console.error("Error loading daily patients:", error); alert("読み込みに失敗しました。"); }
            finally { setLoadingMaster(false); setConfirmLoadModal({ isOpen: false, onConfirm: () => {} }); }
        };
        
        // 既にリストにデータがある場合は、上書き確認モーダルを表示
        if (dailyList.length > 0) { setConfirmLoadModal({ isOpen: true, onConfirm: loadAction }); } else { loadAction(); }
    };
    
    // 本日のリストを全て削除する
    const handleClearDailyList = async () => {
        if (dailyList.length === 0) { alert("リストは既に空です。"); setConfirmClearListModal({ isOpen: false }); return; }
        try {
            const batch = writeBatch(db);
            dailyList.forEach(patient => {
                const docRef = doc(dailyPatientsCollectionRef(selectedCool), patient.id);
                batch.delete(docRef);
            });
            await batch.commit();
        } catch (error) {
            console.error("Error clearing daily list:", error);
            alert("リストの削除に失敗しました。");
        } finally {
            setConfirmClearListModal({ isOpen: false });
        }
    };

    // 本日のリストの患者情報を、患者マスタの最新情報に同期する
    const handleSyncFromMaster = async (dailyPatient) => {
        // 紐づくマスタ患者を特定
        const masterPatient = dailyPatient.masterDocId 
            ? masterPatients.find(p => p.id === dailyPatient.masterDocId)
            : masterPatients.find(p => p.patientId === dailyPatient.masterPatientId);

        if (!masterPatient) {
            alert('同期元のマスター患者が見つかりません。');
            return;
        }

        // 更新が必要なフィールドを特定
        const updates = {};
        if (dailyPatient.masterPatientId !== masterPatient.patientId) {
            updates.masterPatientId = masterPatient.patientId;
        }
        if (dailyPatient.name !== masterPatient.name) {
            updates.name = masterPatient.name;
        }
        if (dailyPatient.furigana !== masterPatient.furigana) {
            updates.furigana = masterPatient.furigana;
        }
        if (dailyPatient.bed !== masterPatient.bed) {
            updates.bed = masterPatient.bed;
        }

        // 差分がなければ何もしない
        if (Object.keys(updates).length === 0) return;

        updates.updatedAt = serverTimestamp();
        const dailyPatientDocRef = doc(dailyPatientsCollectionRef(selectedCool), dailyPatient.id);
        try {
            await updateDoc(dailyPatientDocRef, updates);
        } catch (error) {
            console.error("Failed to sync from master:", error);
            alert('マスターからの同期に失敗しました。');
        }
    };
    
    // --- Render ---
    return (
        <div className="space-y-8">
            {/* 患者マスタ登録・編集モーダル */}
            {masterModalOpen && 
                <CustomModal 
                    title={editingMasterPatient ? "患者情報の編集" : "新規患者登録"} 
                    onClose={handleCloseMasterModal} 
                    footer={
                        <>
                            <button onClick={handleCloseMasterModal} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button>
                            <button onClick={handleMasterSubmit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">保存</button>
                        </>
                    }
                >
                    <form onSubmit={handleMasterSubmit} className="space-y-4">
                        {formError && <p className="text-red-500 text-center font-bold mb-4 bg-red-100 p-3 rounded-lg">{formError}</p>}
                        <div><label className="block font-medium mb-1">患者ID (QRコード用)<RequiredBadge /></label><input type="text" name="patientId" value={masterFormData.patientId} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="電子カルテIDなどを入力" required /></div>
                        <div><label className="block font-medium mb-1">曜日</label><select name="day" value={masterFormData.day} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md"><option value="月水金">月水金</option><option value="火木土">火木土</option></select></div>
                        <div><label className="block font-medium mb-1">クール</label><select name="cool" value={masterFormData.cool} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></div>
                        <div><label className="block font-medium mb-1">ベッド番号<RequiredBadge /></label><input type="text" name="bed" value={masterFormData.bed} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" required /></div>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block font-medium mb-1">姓<RequiredBadge /></label><input type="text" name="lastName" value={masterFormData.lastName} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="例：やまだ" required /></div>
                            <div><label className="block font-medium mb-1">名<RequiredBadge /></label><input type="text" name="firstName" value={masterFormData.firstName} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="例：たろう" required /></div>
                        </div>
                        <div><label className="block font-medium mb-1">ふりがな (ひらがな)</label><input type="text" name="furigana" value={masterFormData.furigana} onChange={handleMasterFormChange} className="w-full p-2 border rounded-md" placeholder="自動入力されます"/></div>
                    </form>
                </CustomModal>
            }

            {/* 臨時患者追加モーダル */}
            {addDailyModalOpen && 
                <CustomModal title="臨時患者の追加" onClose={handleCloseAddDailyModal}>
                    <div className="border-b border-gray-200 mb-4">
                        <nav className="-mb-px flex space-x-6" aria-label="Tabs">
                            <button onClick={() => setDailyModalMode('search')} className={`${dailyModalMode === 'search' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm`}>マスタから検索</button>
                            <button onClick={() => setDailyModalMode('manual')} className={`${dailyModalMode === 'manual' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'} whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm`}>手動で新規登録</button>
                        </nav>
                    </div>
                    {formError && <p className="text-red-500 text-center font-bold mb-4 bg-red-100 p-3 rounded-lg">{formError}</p>}
                    {/* マスタから検索して追加するタブ */}
                    {dailyModalMode === 'search' && (
                        <div>
                            <input type="search" placeholder="患者ID, 氏名, ふりがなで検索" value={tempPatientSearchTerm} onChange={(e) => setTempPatientSearchTerm(e.target.value)} className="w-full p-2 border rounded-md mb-4" />
                            <div className="max-h-60 overflow-y-auto space-y-2">
                                {masterPatients.filter(p => {
                                    const term = tempPatientSearchTerm.toLowerCase();
                                    if (!term) return false; // 検索語がなければ何も表示しない
                                    return (p.patientId && p.patientId.toLowerCase().includes(term)) || 
                                           (p.name && p.name.toLowerCase().includes(term)) || 
                                           (p.furigana && p.furigana.toLowerCase().includes(term));
                                }).map(p => (
                                    <div key={p.id} className="flex justify-between items-center p-2 border rounded-md">
                                        <div>
                                            <p className="font-semibold">{p.name}</p>
                                            <p className="text-sm text-gray-500">ベッド: {p.bed}</p>
                                        </div>
                                        <button onClick={() => handleAddTempFromMaster(p)} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-1 px-3 rounded-md text-sm">追加</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* 手動で新規登録するタブ */}
                    {dailyModalMode === 'manual' && (
                        <form onSubmit={handleAddDailySubmit} className="space-y-4">
                            <div><label className="block font-medium mb-1">ベッド番号<RequiredBadge /></label><input type="text" name="bed" value={dailyFormData.bed} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" required /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="block font-medium mb-1">姓<RequiredBadge /></label><input type="text" name="lastName" value={dailyFormData.lastName} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" placeholder="例：りんじ" required /></div>
                                <div><label className="block font-medium mb-1">名<RequiredBadge /></label><input type="text" name="firstName" value={dailyFormData.firstName} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" placeholder="例：たろう" required /></div>
                            </div>
                            <div><label className="block font-medium mb-1">ふりがな (ひらがな)</label><input type="text" name="furigana" value={dailyFormData.furigana} onChange={handleDailyFormChange} className="w-full p-2 border rounded-md" placeholder="自動入力されます"/></div>
                            <div className="flex justify-end pt-4"><button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">登録</button></div>
                        </form>
                    )}
                </CustomModal>
            }
            
            {/* 本日のリストの患者情報編集モーダル */}
            {editDailyModalOpen && 
                <CustomModal 
                    title="リスト情報の編集" 
                    onClose={handleCloseEditDailyModal} 
                    footer={
                        <>
                            <button onClick={handleCloseEditDailyModal} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">キャンセル</button>
                            <button onClick={handleEditDailySubmit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">保存</button>
                        </>
                    }
                >
                    <form onSubmit={handleEditDailySubmit} className="space-y-4">
                        {formError && <p className="text-red-500 text-center font-bold mb-4 bg-red-100 p-3 rounded-lg">{formError}</p>}
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="block font-medium mb-1">姓<RequiredBadge /></label><input type="text" name="lastName" value={editDailyFormData.lastName} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" required /></div>
                            <div><label className="block font-medium mb-1">名<RequiredBadge /></label><input type="text" name="firstName" value={editDailyFormData.firstName} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" required /></div>
                        </div>
                        <div><label className="block font-medium mb-1">ふりがな (ひらがな)</label><input type="text" name="furigana" value={editDailyFormData.furigana} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" /></div>
                        <div><label className="block font-medium mb-1">ベッド番号<RequiredBadge /></label><input type="text" name="bed" value={editDailyFormData.bed} onChange={handleEditDailyFormChange} className="w-full p-2 border rounded-md" required /></div>
                    </form>
                </CustomModal>
            }
            
            {/* 各種確認モーダル */}
            {confirmMasterDelete.isOpen && <ConfirmationModal title="マスタから削除" message="この患者情報をマスタから完全に削除しますか？" onConfirm={handleConfirmMasterDelete} onCancel={() => setConfirmMasterDelete({ isOpen: false, patientId: null })} confirmText="削除" confirmColor="red" />}
            {confirmDailyDelete.isOpen && <ConfirmationModal title="リストから削除" message="この患者を本日のリストから削除しますか？マスタ登録は残ります。" onConfirm={handleConfirmDailyDelete} onCancel={() => setConfirmDailyDelete({ isOpen: false, patientId: null })} confirmText="削除" confirmColor="red" />}
            {confirmLoadModal.isOpen && <ConfirmationModal title="読み込みの確認" message="既にリストが存在します。上書きしてマスタから再読み込みしますか？" onConfirm={confirmLoadModal.onConfirm} onCancel={() => setConfirmLoadModal({ isOpen: false, onConfirm: () => {} })} confirmText="再読み込み" confirmColor="blue" />}
            {confirmClearListModal.isOpen && <ConfirmationModal title="リストの一括削除" message={`【${selectedFacility} | ${selectedDate} | ${selectedCool}クール】のリストを完全に削除します。よろしいですか？`} onConfirm={handleClearDailyList} onCancel={() => setConfirmClearListModal({ isOpen: false })} confirmText="一括削除" confirmColor="red" />}
            
            {/* 本日の呼び出しリスト作成セクション */}
            <div className="bg-white p-6 rounded-lg shadow-md">
                <h3 className="text-xl font-semibold text-gray-800 border-b pb-3 mb-4">本日の呼び出しリスト作成</h3>
                <p className="text-gray-600 mb-4">グローバル設定（画面上部）で施設・日付・クールを選択し、下のボタンで対象患者を読み込みます。</p>
                <button onClick={handleLoadPatients} className="w-full md:w-auto bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition">
                    対象患者を読み込み
                </button>
            </div>
            
            {/* 本日のリスト表示セクション */}
            <div className="bg-white p-6 rounded-lg shadow">
                 <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 className="text-xl font-semibold text-gray-800">リスト ({selectedCool}クール)</h3>
                    <div className="flex items-center space-x-2">
                        <button title="臨時追加" onClick={handleOpenAddDailyModal} className="flex items-center space-x-2 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-3 rounded-lg transition text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                        </button>
                        <button title="リストから全削除" onClick={() => setConfirmClearListModal({ isOpen: true })} disabled={dailyList.length === 0} className="flex items-center space-x-2 bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded-lg transition disabled:bg-red-300 disabled:cursor-not-allowed text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                 </div>
                 {loadingDaily ? <LoadingSpinner /> : ( dailyList.length > 0 ? ( 
                 <div className="overflow-x-auto">
                    <table className="min-w-full bg-white">
                        <thead className="bg-gray-100">
                            <tr>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">操作</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">状態</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ベッド番号</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">氏名</th>
                                <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ふりがな</th>
                            </tr>
                        </thead>
                        <tbody>
                            {dailyList.slice().sort((a, b) => {
                                // ソート順：退出済を一番下に、それ以外はベッド番号順
                                const isAExited = a.status === '退出済';
                                const isBExited = b.status === '退出済';
                                if (isAExited && !isBExited) return 1;
                                if (!isAExited && isBExited) return -1;
                                return a.bed.localeCompare(b.bed, undefined, { numeric: true });
                            }).map(p => {
                                // 紐づくマスタ患者情報を検索
                                const masterPatient = p.masterDocId 
                                    ? masterPatients.find(mp => mp.id === p.masterDocId) 
                                    : masterPatients.find(mp => mp.patientId === p.masterPatientId);
                                
                                // マスタ情報との差分があるか（同期が必要か）をチェック
                                let isOutOfSync = false;
                                if (masterPatient && masterPatient.updatedAt && p.updatedAt) {
                                    const hasDataDifference = p.name !== masterPatient.name || 
                                                              p.furigana !== masterPatient.furigana || 
                                                              p.bed !== masterPatient.bed ||
                                                              p.masterPatientId !== masterPatient.patientId;
                                    
                                    // データに差分があり、かつマスタの方が新しい場合に同期が必要と判断
                                    if (hasDataDifference && masterPatient.updatedAt.toDate() > p.updatedAt.toDate()) {
                                        isOutOfSync = true;
                                    }
                                }
                                return (
                                <tr key={p.id} className="border-b hover:bg-gray-50">
                                    <td className="p-2"><div className="flex space-x-2">
                                        {/* マスタとの同期ボタン */}
                                        {isOutOfSync && 
                                            <button title="マスターから更新" onClick={() => handleSyncFromMaster(p)} className="p-2 rounded bg-teal-500 hover:bg-teal-600 text-white">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-4.13M20 15a9 9 0 01-14.13 4.13" /></svg>
                                            </button>
                                        }
                                        {/* ステータスに応じた操作ボタン */}
                                        {p.status === '治療中' && 
                                            <button title="呼出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '呼出中')} className="p-2 rounded bg-blue-500 hover:bg-blue-600 text-white">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                                            </button>
                                        }
                                        {p.status === '呼出中' && 
                                            <> 
                                                <button title="退出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '退出済')} className="p-2 rounded bg-purple-500 hover:bg-purple-600 text-white">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                                </button> 
                                                <button title="キャンセル" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '治療中')} className="p-2 rounded bg-gray-500 hover:bg-gray-600 text-white">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg>
                                                </button>
                                            </>
                                        }
                                        {p.status === '退出済' && 
                                            <button title="治療中に戻す" onClick={() => updatePatientStatus(selectedFacility, selectedDate, selectedCool, p.id, '治療中')} className="p-2 rounded bg-gray-500 hover:bg-gray-600 text-white">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                            </button>
                                        }
                                        {/* 編集・削除ボタン */}
                                        <button title="編集" onClick={() => handleOpenEditDailyModal(p)} className="p-2 rounded bg-yellow-500 hover:bg-yellow-600 text-white">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                        </button>
                                        <button title="削除" onClick={() => handleDeleteDailyClick(p.id)} className="p-2 rounded bg-red-500 hover:bg-red-600 text-white">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        </button>
                                    </div></td>
                                    <td className="p-2 text-sm whitespace-nowrap"><StatusBadge status={p.status} /></td>
                                    <td className="p-2 text-sm whitespace-nowrap">{p.bed}</td>
                                    <td className="p-2 text-sm whitespace-nowrap">{p.name}{p.isTemporary && <span className="ml-2 text-xs bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full">臨時</span>}</td>
                                    <td className="p-2 text-sm whitespace-nowrap">{p.furigana}</td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
                ) : <p className="text-center py-8 text-gray-500">リストが空です。上記ボタンから患者を読み込んでください。</p>)}
            </div>
            {/* 患者マスタ表示セクション */}
            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4 border-b pb-2">
                    <h3 className="text-xl font-semibold text-gray-800">通常患者マスタ</h3>
                    <div className="flex items-center space-x-2">
                        <input type="search" placeholder="患者ID, 氏名, ふりがなで検索" value={masterSearchTerm} onChange={(e) => setMasterSearchTerm(e.target.value)} className="p-2 border rounded-md text-sm"/>
                        <button title="患者マスタ追加" onClick={() => handleOpenMasterModal()} className="flex items-center space-x-2 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-3 rounded-lg transition text-sm">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                        </button>
                    </div>
                </div>
                {loadingMaster ? <LoadingSpinner /> : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white">
                            <thead className="bg-gray-100">
                                <tr>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">操作</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">曜日</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">クール</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ベッド番号</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">氏名</th>
                                    <th className="p-2 text-left text-sm font-semibold whitespace-nowrap">ふりがな</th>
                                </tr>
                            </thead>
                            <tbody>
                                {masterPatients.length > 0 ? 
                                    masterPatients.filter(p => { 
                                        // 検索機能
                                        const term = masterSearchTerm.toLowerCase();
                                        if (!term) return true;
                                        return (p.patientId && p.patientId.toLowerCase().includes(term)) ||
                                               (p.name && p.name.toLowerCase().includes(term)) || 
                                               (p.furigana && p.furigana.toLowerCase().includes(term));
                                    })
                                    .sort((a, b) => {
                                        // ソート順：曜日 -> クール -> ベッド番号
                                        const dayOrder = { '月水金': 1, '火木土': 2 }; const dayCompare = (dayOrder[a.day] || 99) - (dayOrder[b.day] || 99);
                                        if (dayCompare !== 0) return dayCompare;
                                        const coolCompare = a.cool.localeCompare(b.cool, undefined, { numeric: true });
                                        if (coolCompare !== 0) return coolCompare;
                                        return a.bed.localeCompare(b.bed, undefined, { numeric: true });
                                    }).map(p => (
                                        <tr key={p.id} className="border-b hover:bg-gray-50">
                                            <td className="p-2">
                                                <div className="flex space-x-2">
                                                    <button title="編集" onClick={() => handleOpenMasterModal(p)} className="p-2 rounded bg-yellow-500 hover:bg-yellow-600 text-white">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    </button>
                                                    <button title="削除" onClick={() => handleDeleteMasterClick(p.id)} className="p-2 rounded bg-red-500 hover:bg-red-600 text-white">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.day}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.cool}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.bed}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.name}</td>
                                            <td className="p-2 text-sm whitespace-nowrap">{p.furigana}</td>
                                        </tr>
                                    )) : 
                                    <tr><td colSpan="6" className="text-center py-8 text-gray-500">この施設にはまだ患者が登録されていません。</td></tr>
                                }
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- 2. Monitor Page ---
// 呼び出し状況を大画面に表示するためのモニターページ。音声読み上げ機能を持つ。
const MonitorPage = () => {
    const { allPatients, loading } = useAllDayPatients(); // 全クールの患者データを取得
    // 表示用に患者をフィルタリング・ソート
    const callingPatients = allPatients.filter(p => p.status === '呼出中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));
    const treatmentPatients = allPatients.filter(p => p.status === '治療中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));
    
    // --- 音声読み上げ機能関連のState & Ref ---
    const prevCallingPatientIdsRef = useRef(new Set()); // 前回の呼び出し中患者IDセット
    const [isSpeaking, setIsSpeaking] = useState(false); // 現在、音声再生中かどうかのフラグ
    const speechQueueRef = useRef([]); // 読み上げ待機中の患者キュー
    
    // --- 音声停止機能のために追加 ---
    const currentAudioRef = useRef(null); // 現在再生中のAudioオブジェクトを管理
    const nowPlayingRef = useRef(null);   // 現在再生中の患者情報を管理
    const nextSpeechTimerRef = useRef(null); // 次の再生までのタイマーを管理
    // --- ここまで ---

    // キューから次の患者を取り出して音声合成・再生を実行する関数
    const speakNextInQueue = useCallback(() => {
        // 既存のタイマーがあればクリア（予期せぬ連続再生を防ぐ）
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
        const patient = speechQueueRef.current.shift(); // キューの先頭から患者を取り出す
        nowPlayingRef.current = patient; // 再生中の患者を記録

        const nameToSpeak = patient.furigana || patient.name; // ふりがなを優先して使用
        const textToSpeak = `${nameToSpeak}さんのお迎えのかた、${patient.bed}番ベッドへお願いします。`;
        
        // Google Cloud Functionsのエンドポイント（Text-to-Speechを実行）
        const functionUrl = "https://synthesizespeech-dewqhzsp5a-uc.a.run.app";

        if (!textToSpeak || textToSpeak.trim() === "") {
            // テキストが空なら1秒後に次へ
            nextSpeechTimerRef.current = setTimeout(speakNextInQueue, 1000);
            return;
        }

        // Cloud Functionを呼び出して音声データを取得
        fetch(functionUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: textToSpeak }),
        })
        .then(res => res.json())
        .then(data => {
            if (data.audioContent) {
                const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
                currentAudioRef.current = audio; // Audioオブジェクトを記録
                audio.play();
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
    }, []); // 依存配列は空

    // callingPatients（呼び出し中患者リスト）の変更を検知して、音声再生キューを管理する
    useEffect(() => {
        const currentCallingIds = new Set(callingPatients.map(p => p.id));
        const prevCallingIds = prevCallingPatientIdsRef.current;

        // 1. 新しく「呼出中」になった患者を特定し、キューに追加
        const newPatientsToCall = callingPatients.filter(p => !prevCallingIds.has(p.id));
        if (newPatientsToCall.length > 0) {
            speechQueueRef.current.push(...newPatientsToCall);
            // 現在再生中でなければ、再生を開始する
            if (!isSpeaking) {
                speakNextInQueue();
            }
        }
        
        // 2. 「呼出中」から除外された（キャンセルされた）患者を特定
        const cancelledPatientIds = [...prevCallingIds].filter(id => !currentCallingIds.has(id));
        if (cancelledPatientIds.length > 0) {
            const cancelledIdSet = new Set(cancelledPatientIds);

            // 3. 再生待機キューの中からキャンセルされた患者を削除
            speechQueueRef.current = speechQueueRef.current.filter(p => !cancelledIdSet.has(p.id));
            
            // 4. もし現在再生中の患者がキャンセルされた場合、音声を即時停止
            if (nowPlayingRef.current && cancelledIdSet.has(nowPlayingRef.current.id)) {
                if (currentAudioRef.current) {
                    currentAudioRef.current.pause(); // 音声を停止
                    currentAudioRef.current = null;
                }
                nowPlayingRef.current = null;
                // 次の再生タイマーもキャンセル
                if (nextSpeechTimerRef.current) {
                    clearTimeout(nextSpeechTimerRef.current);
                    nextSpeechTimerRef.current = null;
                }
                // 即座に次の患者の再生を開始
                speakNextInQueue();
            }
        }
        
        // 今回の呼び出し中患者IDを保存
        prevCallingPatientIdsRef.current = currentCallingIds;
    }, [callingPatients, isSpeaking, speakNextInQueue]);
    
    if (loading) return <LoadingSpinner text="モニターデータを読み込み中..." />;
    
    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 text-center text-gray-700">呼び出しモニター</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* お呼び出し済みリスト */}
                <div className="bg-blue-100 p-6 rounded-lg shadow-lg">
                    <h3 className="text-2xl font-semibold mb-4 text-blue-800 text-center">お呼び出し済み</h3>
                    <div className="space-y-3 text-center">
                        {callingPatients.length > 0 ? 
                            callingPatients.map(p => (
                                <p key={p.id} className="text-2xl md:text-3xl p-4 bg-white rounded-md shadow">
                                    No.{p.bed} {p.name} 様
                                </p>
                            )) : 
                            <p className="text-gray-500">現在、お呼び出し済みの患者さんはいません。</p>
                        }
                    </div>
                </div>
                {/* 治療中リスト */}
                <div className="bg-green-100 p-6 rounded-lg shadow-lg">
                    <h3 className="text-2xl font-semibold mb-4 text-green-800 text-center">治療中</h3>
                     <div className="space-y-3 text-center">
                        {treatmentPatients.length > 0 ? 
                            treatmentPatients.map(p => (
                                <p key={p.id} className="text-2xl md:text-3xl p-4 bg-white rounded-md shadow">
                                    No.{p.bed} {p.name} 様
                                </p>
                            )) : 
                            <p className="text-gray-500">現在、治療中の患者さんはいません。</p>
                        }
                    </div>
                </div>
            </div>
            {/* 音声再生中のインジケーター */}
            {isSpeaking && 
                <div className="fixed bottom-5 right-5 bg-yellow-400 text-black font-bold py-2 px-4 rounded-full shadow-lg flex items-center">
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

// --- 3. Staff Page ---
// スタッフが患者の呼び出し操作を行うためのページ。
const StaffPage = () => {
    const { allPatients, loading } = useAllDayPatients(); // 全クールの患者データを取得
    const { selectedFacility, selectedDate } = useContext(AppContext);
    
    const [isScannerOpen, setScannerOpen] = useState(false); // QRスキャナーモーダルの開閉

    // 操作対象となる患者（治療中 or 呼出中）をリストアップ
    const actionPatients = allPatients
        .filter(p => p.status === '治療中' || p.status === '呼出中')
        .sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));

    // QR/バーコードスキャン成功時のコールバック関数
    const handleScanSuccess = useCallback((decodedText) => {
        let result;
        // スキャンされたID（患者ID）に一致し、かつステータスが「治療中」の患者を探す
        const patientToCall = allPatients.find(p => p.masterPatientId === decodedText && p.status === '治療中');

        if (patientToCall) {
            // 患者が見つかれば、ステータスを「呼出中」に更新
            updatePatientStatus(selectedFacility, selectedDate, patientToCall.cool, patientToCall.id, '呼出中');
            result = { success: true, message: `${patientToCall.name} さんを呼び出しました。` };
        } else {
            // 既に呼び出し済みか、リストにいない場合
            const alreadyCalled = allPatients.find(p => p.masterPatientId === decodedText);
            if (alreadyCalled) {
                result = { success: false, message: `既にお呼び出し済みか、対象外です。` };
            } else {
                result = { success: false, message: '患者が見つかりません。' };
            }
        }
        return result; // スキャン結果をモーダルに返す
    }, [allPatients, selectedFacility, selectedDate]);
    
    if (loading) return <LoadingSpinner text="呼び出しリストを読み込み中..." />;

    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">スタッフ用端末</h2>
            {/* QRスキャナーモーダル */}
            {isScannerOpen && 
                <QrScannerModal 
                    onClose={() => setScannerOpen(false)} 
                    onScanSuccess={handleScanSuccess}
                />
            }
            <div className="bg-white p-6 rounded-lg shadow">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold">呼び出し操作 (全クール)</h3>
                    <button 
                        onClick={() => setScannerOpen(true)} 
                        title="コード読み込み" // ツールチップ
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold p-3 rounded-lg transition" // アイコン用にpaddingを調整
                    >
                        {/* カメラアイコン */}
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
                </div>
                <div className="overflow-x-auto">
                    {actionPatients.length > 0 ? (
                        <div className="space-y-3">
                            {/* 操作対象患者のリスト */}
                            {actionPatients.map(p => (
                                <div key={p.id} className="flex items-center p-3 bg-gray-50 rounded-lg shadow-sm min-w-max">
                                    <div className="whitespace-nowrap pr-4 flex space-x-2">
                                        {/* 治療中 -> 呼出中にするボタン */}
                                        {p.status === '治療中' && 
                                            <button title="呼出" onClick={() => updatePatientStatus(selectedFacility, selectedDate, p.cool, p.id, '呼出中')} className="p-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                                            </button>
                                        }
                                        {/* 呼出中 -> 治療中に戻す（キャンセル）ボタン */}
                                        {p.status === '呼出中' &&
                                            <button title="キャンセル" onClick={() => updatePatientStatus(selectedFacility, selectedDate, p.cool, p.id, '治療中')} className="p-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white transition">
                                                 <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg>
                                            </button>
                                        }
                                    </div>
                                    <div className="flex items-center whitespace-nowrap">
                                        <StatusBadge status={p.status}/>
                                        <span className="text-sm font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded ml-2 mr-3">{p.cool}クール</span>
                                        <span className="text-lg font-medium mr-4">No.{p.bed} {p.name} 様</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (<p className="text-gray-500 text-center py-4">操作対象の患者さんはいません。</p>)}
                </div>
            </div>
        </div>
    );
};

// QR/バーコードスキャナーのモーダルコンポーネント
const QrScannerModal = ({ onClose, onScanSuccess }) => {
    const [scanResult, setScanResult] = useState(null); // スキャン結果のメッセージ
    const isProcessingRef = useRef(false); // 短時間での連続スキャンを防ぐためのフラグ
    
    // onScanSuccess関数が再生成されても最新のものを参照するためのref
    const onScanSuccessRef = useRef(onScanSuccess);
    useEffect(() => {
        onScanSuccessRef.current = onScanSuccess;
    }, [onScanSuccess]);

    // --- カメラ切り替え機能 ---
    const [cameras, setCameras] = useState([]); // 利用可能なカメラのリスト
    const [selectedCameraId, setSelectedCameraId] = useState(''); // 選択中のカメラID
    // --- 画面回転検知 ---
    const [orientation, setOrientation] = useState(window.screen.orientation.type);

    // デバイスのカメラを取得し、stateにセットする
    useEffect(() => {
        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                setCameras(devices);
                // 選択中のカメラがなければ、背面カメラ('back')を優先的に選択する
                if (!selectedCameraId) {
                    const backCamera = devices.find(device => device.label.toLowerCase().includes('back')) || devices[0];
                    setSelectedCameraId(backCamera.id);
                }
            }
        }).catch(err => {
            console.error("カメラの取得に失敗しました。", err);
        });
    }, [selectedCameraId]);
    // --- ここまでカメラ切り替え機能 ---

    // --- 画面回転イベントの監視 ---
    useEffect(() => {
        const handleOrientationChange = () => {
            setOrientation(window.screen.orientation.type);
        };
        window.screen.orientation.addEventListener('change', handleOrientationChange);
        return () => {
            window.screen.orientation.removeEventListener('change', handleOrientationChange);
        };
    }, []);
    // --- ここまで画面回転イベントの監視 ---


    // 選択されたカメラでスキャンを開始する
    useEffect(() => {
        if (!selectedCameraId) return;

        const html5QrCode = new Html5Qrcode('qr-reader-container');
        
        // スキャン成功時のコールバック
        const qrCodeSuccessCallback = (decodedText, decodedResult) => {
            if (isProcessingRef.current) return; // 処理中なら何もしない
            isProcessingRef.current = true;
            
            // 親コンポーネントから渡された処理を実行
            const result = onScanSuccessRef.current(decodedText);
            setScanResult(result); // 結果メッセージを表示
            
            // 1秒後に連続スキャン防止フラグを解除
            setTimeout(() => {
                isProcessingRef.current = false;
            }, 1000);
        };

        // --- スキャナの設定 ---
        const config = { 
            fps: 10, 
            qrbox: { width: 250, height: 250 }, // スキャン領域のサイズ
            formatsToScan: [ // 読み取り対象のフォーマット
                Html5QrcodeSupportedFormats.QR_CODE,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.CODABAR, // NW-7 (Codabar)
            ]
        };
        // --- ここまでスキャナ設定 ---

        // スキャン開始
        html5QrCode.start(
            selectedCameraId,
            config,
            qrCodeSuccessCallback,
            undefined // エラーコールバックは未使用
        ).catch(err => {
            console.error("スキャンの開始に失敗しました。", err);
            setScanResult({ success: false, message: "カメラの起動に失敗しました。" });
        });

        // コンポーネントのアンマウント時にスキャナを停止するクリーンアップ処理
        return () => {
            if (html5QrCode && html5QrCode.isScanning) {
                html5QrCode.stop().catch(err => {
                    console.error("スキャナの停止に失敗しました。", err);
                });
            }
        };
    }, [selectedCameraId, orientation]); // selectedCameraIdまたはorientationが変わったらスキャナを再起動

    // カメラを切り替える
    const handleCameraSwitch = () => {
        if (cameras.length < 2) return;
        const currentIndex = cameras.findIndex(c => c.id === selectedCameraId);
        const nextIndex = (currentIndex + 1) % cameras.length;
        setSelectedCameraId(cameras[nextIndex].id);
    };

    return (
        <CustomModal 
            title="QR/バーコードで呼び出し" 
            onClose={onClose} 
            footer={
                <button onClick={onClose} className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-6 rounded-lg">
                    閉じる
                </button>
            }
        >
            {/* スキャナが表示されるコンテナ */}
            <div id="qr-reader-container" className="w-full relative"></div>
            
            {/* カメラが複数ある場合に切り替えボタンを表示 */}
            {cameras.length > 1 && (
                <div className="text-center mt-3">
                    <button 
                        onClick={handleCameraSwitch} 
                        className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg transition inline-flex items-center"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114.13-4.13M20 15a9 9 0 01-14.13 4.13" />
                        </svg>
                        カメラ切替
                    </button>
                </div>
            )}
            
            {/* スキャン結果のメッセージ表示 */}
            {scanResult && (
                <div className={`mt-4 p-3 rounded text-center font-semibold ${scanResult.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {scanResult.message}
                </div>
            )}
        </CustomModal>
    );
};


// --- 4. Driver Page ---
// 送迎担当者向けのページ。呼び出し中の患者のみを表示するシンプルな画面。
const DriverPage = () => {
    const { allPatients, loading } = useAllDayPatients();
    const callingPatients = allPatients.filter(p => p.status === '呼出中').sort((a, b) => a.bed.localeCompare(b.bed, undefined, {numeric: true}));
    if (loading) return <LoadingSpinner text="送迎リストを読み込み中..." />;
    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">送迎担当者用画面</h2>
            <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-xl font-semibold mb-4">お呼び出し済みの患者様</h3>
                {callingPatients.length > 0 ? (
                    <div className="space-y-3">
                        {callingPatients.map(p => (
                            <div key={p.id} className="p-4 bg-blue-100 rounded-lg text-blue-800 font-semibold text-lg">
                                No.{p.bed} {p.name} 様
                            </div>
                        ))}
                    </div>
                ) : (<p className="text-gray-500 text-center py-4">現在、お呼び出し済みの患者さんはいません。</p>)}
            </div>
        </div>
    );
};

// --- Global Controls & Layout ---
// 画面上部に表示される、施設・日付・クールを選択するためのグローバルコントロール。
const GlobalControls = ({ hideCoolSelector = false }) => {
    const { selectedFacility, setSelectedFacility, selectedDate, setSelectedDate, selectedCool, setSelectedCool } = useContext(AppContext);
    return (
        <div className={`w-full bg-gray-100 p-3 rounded-lg mt-4 grid grid-cols-1 sm:grid-cols-${hideCoolSelector ? '2' : '3'} gap-3`}>
            <div>
                <label htmlFor="global-facility" className="block text-xs font-medium text-gray-600">施設</label>
                <select id="global-facility" value={selectedFacility} onChange={(e) => setSelectedFacility(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm">
                    {FACILITIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
            </div>
            <div>
                <label htmlFor="global-date" className="block text-xs font-medium text-gray-600">日付</label>
                <input type="date" id="global-date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm" />
            </div>
            {/* hideCoolSelectorがtrueの場合、クールセレクターを非表示にする */}
            {!hideCoolSelector && (
                <div>
                    <label htmlFor="global-cool" className="block text-xs font-medium text-gray-600">クール</label>
                    <select id="global-cool" value={selectedCool} onChange={e => setSelectedCool(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md transition text-sm">
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                    </select>
                </div>
            )}
        </div>
    );
};

// アプリ全体のレイアウトを定義するコンポーネント（ヘッダー、メインコンテンツ、フッター）。
const AppLayout = ({ children, navButtons, user, onGoBack, hideCoolSelector }) => (
    <div className="min-h-screen bg-gray-50 font-sans">
        <nav className="bg-white shadow-md p-3 sm:p-4 mb-8 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex flex-wrap justify-between items-center">
                    <div className="flex items-center">
                        {/* 戻るボタン（役割選択画面に戻る） */}
                        {onGoBack && (
                           <button onClick={onGoBack} className="mr-4 flex items-center text-sm text-gray-600 hover:text-blue-600 transition">
                               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                               </svg>
                               <span className="hidden sm:inline ml-1">戻る</span>
                           </button>
                        )}
                        <h1 className="text-lg sm:text-xl font-bold text-gray-800">患者呼び出しシステム</h1>
                    </div>
                    <div className="flex items-center space-x-1 sm:space-x-2 mt-2 sm:mt-0">
                       {/* ページ切り替えボタンなどがここに入る */}
                       {navButtons}
                    </div>
                </div>
                {/* グローバルコントロール（施設・日付・クール選択） */}
                <GlobalControls hideCoolSelector={hideCoolSelector} />
            </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 pb-8">{children}</main>
         <footer className="text-center text-sm text-gray-500 py-6 mt-8 border-t"><p>ユーザーID: <span className="font-mono text-xs">{user?.uid}</span></p></footer>
    </div>
);

// --- Role-based Views ---
// スタッフ用のビュー。管理、スタッフ、モニターの各ページを切り替えて表示する。
const StaffView = ({ user, onGoBack }) => {
    const [currentPage, setCurrentPage] = useState('admin'); // 'admin', 'staff', 'monitor'
    // ページによってクールセレクターの表示/非表示を切り替える
    const hideCoolSelector = currentPage === 'monitor' || currentPage === 'staff';
    // ページ切り替えボタン
    const NavButton = ({ page, label }) => (
        <button 
            onClick={() => setCurrentPage(page)} 
            className={`px-3 py-2 sm:px-4 rounded-lg font-medium transition duration-200 text-sm sm:text-base ${ currentPage === page ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-gray-700 hover:bg-gray-200'}`}
        >
            {label}
        </button>
    );
    
    // 現在のページに応じてコンポーネントをレンダリング
    const renderPage = () => {
        switch (currentPage) {
            case 'admin': return <AdminPage />;
            case 'staff': return <StaffPage />;
            case 'monitor': return <MonitorPage />;
            default: return <AdminPage />;
        }
    };
    
    return (
        <AppLayout 
            user={user} 
            onGoBack={onGoBack} 
            hideCoolSelector={hideCoolSelector} 
            navButtons={
                <>
                    <NavButton page="admin" label="管理" />
                    <NavButton page="staff" label="スタッフ" />
                    <NavButton page="monitor" label="モニター" />
                </>
            }
        >
            {renderPage()}
        </AppLayout>
    );
}

// 公開用（送迎担当者用）のビュー。
const PublicView = ({ user, onGoBack }) => {
    return (
        <AppLayout user={user} onGoBack={onGoBack} hideCoolSelector={true} navButtons={<span className="font-semibold text-gray-700">送迎担当者用</span>}>
            <DriverPage />
        </AppLayout>
    );
};

// --- Login / Role Selection ---
// 施設選択ページ。
const FacilitySelectionPage = ({ onSelectFacility, onGoBack }) => (
    <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-md w-full">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">施設を選択してください</h1>
            <p className="text-gray-600 mb-8">表示する施設を選択してください。</p>
            <div className="space-y-4">
                {FACILITIES.map(facility => (
                    <button 
                        key={facility} 
                        onClick={() => onSelectFacility(facility)} 
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg"
                    >
                        {facility}
                    </button>
                ))}
            </div>
            <button onClick={onGoBack} className="mt-8 text-sm text-gray-600 hover:text-blue-600 transition">
                役割選択に戻る
            </button>
        </div>
    </div>
);

// スタッフ用のパスワード認証モーダル。
const PasswordModal = ({ onSuccess, onCancel }) => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    
    const CORRECT_PASSWORD = '2366'; // 固定パスワード

    const handleSubmit = (e) => {
        e.preventDefault();
        if (password === CORRECT_PASSWORD) {
            onSuccess(); // 成功コールバックを実行
        } else {
            setError('パスワードが違います。');
        }
    };

    return (
        <CustomModal title="スタッフ用パスワード認証" onClose={onCancel}>
            <form onSubmit={handleSubmit}>
                <p className="mb-4">スタッフ用のパスワードを入力してください。</p>
                <input 
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    className="w-full p-2 border rounded-md"
                    autoFocus
                />
                {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                <div className="mt-6 flex justify-end">
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg">
                        認証
                    </button>
                </div>
            </form>
        </CustomModal>
    );
};

// アプリ起動時に表示される役割選択ページ。
const RoleSelectionPage = ({ onSelectRole }) => {
    return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center p-8 bg-white rounded-xl shadow-lg max-w-md w-full">
            <h1 className="text-3xl font-bold text-gray-800 mb-4">患者呼び出しシステム</h1>
            <p className="text-gray-600 mb-8">利用する役割を選択してください</p>
            <div className="space-y-4">
                <button onClick={() => onSelectRole('staff')} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg">
                    スタッフ用
                </button>
                <button onClick={() => onSelectRole('public')} className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-4 px-6 rounded-lg transition duration-300 text-lg">
                    公開用 (送迎)
                </button>
            </div>
        </div>
    </div>
    );
};


// --- Main App ---
// アプリケーションのルートコンポーネント。
export default function App() {
    // --- State ---
    const [user, setUser] = useState(null); // Firebase認証ユーザー
    const [authReady, setAuthReady] = useState(false); // 認証処理が完了したか
    const [viewMode, setViewMode] = useState('login'); // 表示モード: 'login', 'password', 'facilitySelection', 'staff', 'public'
    const [selectedRole, setSelectedRole] = useState(null); // 選択された役割: 'staff' or 'public'
    
    // --- AppContextで提供するグローバルな状態 ---
    const [selectedFacility, setSelectedFacility] = useState(FACILITIES[0]); // 選択中の施設
    const [selectedDate, setSelectedDate] = useState(getTodayString()); // 選択中の日付
    const [selectedCool, setSelectedCool] = useState('1'); // 選択中のクール

    // --- Effects ---
    // アプリ起動時にFirebase匿名認証を行う
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
            } else {
                try {
                    await signInAnonymously(auth); // ユーザーがいなければ匿名サインイン
                } catch (error) {
                    console.error("Anonymous sign-in failed:", error);
                }
            }
            setAuthReady(true); // 認証処理完了
        });
        return () => unsubscribe(); // クリーンアップ
    }, []);

    // --- Handlers ---
    // 役割選択時のハンドラ
    const handleRoleSelect = (role) => {
        setSelectedRole(role);
        if (role === 'staff') {
            setViewMode('password'); // スタッフ用ならパスワード認証へ
        } else {
            setViewMode('facilitySelection'); // 公開用なら施設選択へ
        }
    };

    // パスワード認証成功時のハンドラ
    const handlePasswordSuccess = () => {
        setViewMode('facilitySelection'); // 施設選択へ
    };

    // 施設選択時のハンドラ
    const handleFacilitySelect = (facility) => {
        setSelectedFacility(facility);
        setViewMode(selectedRole); // 選択した役割のビューへ遷移
    };
    
    // 最初の役割選択画面に戻るハンドラ
    const handleGoBack = () => {
        setViewMode('login');
        setSelectedRole(null);
    };

    // 認証情報が準備できるまでローディング画面を表示
    if (!authReady || !user) {
        return <div className="h-screen w-screen flex justify-center items-center bg-gray-100"><LoadingSpinner text="認証情報を確認中..." /></div>;
    }

    // --- Render ---
    // AppContext.Providerでグローバルな状態を配下のコンポーネントに提供
    return (
        <AppContext.Provider value={{ selectedFacility, setSelectedFacility, selectedDate, setSelectedDate, selectedCool, setSelectedCool }}>
            {/* viewModeに応じて表示するコンポーネントを切り替え */}
            {viewMode === 'login' && <RoleSelectionPage onSelectRole={handleRoleSelect} />}
            {viewMode === 'password' && <PasswordModal onSuccess={handlePasswordSuccess} onCancel={() => setViewMode('login')} />}
            {viewMode === 'facilitySelection' && <FacilitySelectionPage onSelectFacility={handleFacilitySelect} onGoBack={() => setViewMode('login')} />}
            {viewMode === 'staff' && <StaffView user={user} onGoBack={handleGoBack} />}
            {viewMode === 'public' && <PublicView user={user} onGoBack={handleGoBack} />}
        </AppContext.Provider>
    );
}

