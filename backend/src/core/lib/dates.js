// backend/src/core/lib/dates.js — ngày theo GIỜ VIỆT NAM (đồng bộ với todayYmd ở src/ui.js của FE).
// G2: new Date().toISOString().slice(0,10) là ngày UTC → trước 7h sáng giờ VN bị lùi 1 ngày.
const VN_TZ = 'Asia/Ho_Chi_Minh';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: VN_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

// 'YYYY-MM-DD' của hôm nay (hoặc của mốc d) theo giờ VN
const vnToday = (d = new Date()) => fmt.format(d);

module.exports = { VN_TZ, vnToday };
