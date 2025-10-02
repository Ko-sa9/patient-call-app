import { useContext, useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { AppContext } from '../context/AppContext';
import { db } from '../firebase';

export const useDailyList = () => {
    // ... (useDailyList hook remains the same for now)
};

const getDayOfWeekString = (dateString) => {
    const date = new Date(dateString);
    const day = date.getDay();
    // 月水金 (1, 3, 5) or 火木土 (2, 4, 6)
    if ([1, 3, 5].includes(day)) {
        return '月水金';
    } else if ([2, 4, 6].includes(day)) {
        return '火木土';
    }
    return null; // Sunday or invalid date
};

export const useMasterPatients = () => {
    const { selectedFacility, selectedDate } = useContext(AppContext);
    const [masterPatients, setMasterPatients] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!selectedFacility) {
            setMasterPatients([]);
            setLoading(false);
            return;
        }
        setLoading(true);

        const masterPatientsCollectionRef = collection(db, 'masterPatients');
        const q = query(
            masterPatientsCollectionRef,
            where("facility", "==", selectedFacility)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedPatients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMasterPatients(fetchedPatients);
            setLoading(false);
        }, (err) => {
            console.error("Master patients fetch error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [selectedFacility]);

    return { masterPatients, loading };
};

export const useAllDayPatients = () => {
    const { selectedFacility, selectedDate } = useContext(AppContext);
    const [allPatients, setAllPatients] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!selectedFacility || !selectedDate) {
            setAllPatients([]);
            setLoading(false);
            return;
        }
        setLoading(true);

        const dayString = selectedDate.toISOString().split('T')[0];
        const dailyListDocRef = doc(db, 'daily_lists', `${selectedFacility}_${dayString}`);
        const patientsCollectionRef = collection(dailyListDocRef, 'patients');

        const unsubscribe = onSnapshot(patientsCollectionRef, (snapshot) => {
            const fetchedPatients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllPatients(fetchedPatients);
            setLoading(false);
        }, (err) => {
            console.error("All day patients fetch error:", err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [selectedFacility, selectedDate]);

    return { allPatients, loading };
};

export const updatePatientStatus = async (facility, date, cool, patientDocId, newStatus) => {
    const dayString = date.toISOString().split('T')[0];
    const dailyListDocRef = doc(db, 'daily_lists', `${facility}_${dayString}`);
    const patientDocRef = doc(collection(dailyListDocRef, 'patients'), patientDocId);

    try {
        await updateDoc(patientDocRef, {
            status: newStatus,
            statusChangedAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error updating patient status: ", error);
        alert("患者のステータスの更新に失敗しました。");
    }
};

export const callPatient = async (patientId) => {
    const patientDocRef = doc(db, 'masterPatients', patientId);
    try {
        await updateDoc(patientDocRef, {
            calledAt: serverTimestamp()
        });
    } catch (error) {
        console.error("Error calling patient: ", error);
        alert("患者の呼び出しに失敗しました。");
    }
};
