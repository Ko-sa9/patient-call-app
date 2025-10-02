import { createContext } from 'react';

export const FACILITIES = ["本院透析室", "坂田透析棠", "じんクリニック", "木更津クリニック"];

export const AppContext = createContext();

export const getTodayString = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

export const getDayQueryString = (date) => {
    if (!date) return getTodayString();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};
