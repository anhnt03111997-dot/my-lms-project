// ─────────────────────────────────────────────────────────────
// firestore-progress.js — Lưu tiến độ học tập lên Firestore
// (có fallback localStorage khi offline). Expose qua window.firestoreProgress
// ─────────────────────────────────────────────────────────────
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDx85zsy3UfYyjV9raZLY0knwIwho8UhLg",
  authDomain: "amela-lms.firebaseapp.com",
  projectId: "amela-lms",
  storageBucket: "amela-lms.firebasestorage.app",
  messagingSenderId: "833013103244",
  appId: "1:833013103244:web:80ea9e14f887b50e4bd9a9"
};

// Khởi tạo (tái dùng app nếu trang đã init Firebase ở chỗ khác)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app); // QUAN TRỌNG: khởi tạo Auth trên CÙNG app để Firestore gắn được token đăng nhập

// Chờ Firebase Auth khôi phục phiên (onAuthStateChanged chạy bất đồng bộ sau khi tải trang).
// Nếu ghi Firestore TRƯỚC khi auth sẵn sàng → request.auth = null → permission-denied.
let _authReady = false;
let _authUser = null;
const _authReadyPromise = new Promise(function(resolve){
  onAuthStateChanged(auth, function(user){
    _authReady = true;
    _authUser = user;
    console.log('[Firestore] onAuthStateChanged → currentUser:', user ? user.uid : null);
    resolve(user);
  });
});
function whenAuthReady(){ return _authReady ? Promise.resolve(_authUser) : _authReadyPromise; }

// Lấy userId — ưu tiên phiên Auth thật (uid này mới khớp request.auth.uid trong Rules), fallback localStorage
function getUserId(){
  if(auth.currentUser) return auth.currentUser.uid;
  const raw = localStorage.getItem('lms_user');
  if(!raw) return null;
  try { return JSON.parse(raw).uid; } catch(e){ return null; }
}

// Ghi cache localStorage khi offline / fallback
function cacheLessonLocal(courseId, lessonId, data){
  const local = JSON.parse(localStorage.getItem('lms_progress') || '{}');
  if(!local[courseId]) local[courseId] = {};
  if(!local[courseId].lessons) local[courseId].lessons = {};
  local[courseId].lessons[lessonId] = {
    status: data.status,
    quizScore: data.quizScore != null ? data.quizScore : null,
    quizPassed: !!data.quizPassed,
    answeredQuestions: data.answeredQuestions || [],
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem('lms_progress', JSON.stringify(local));
}

// ── 1. Lưu tiến độ 1 bài học ──────────────────────────────────
async function saveLessonProgress(courseId, lessonId, data){
  await whenAuthReady();                          // chờ Auth khôi phục phiên đăng nhập
  console.log('Auth user:', auth.currentUser);    // debug: phải KHÁC null mới ghi được Firestore
  if(!auth.currentUser){
    console.error('[Firestore] ✗ Chưa đăng nhập (auth.currentUser = null) → request.auth sẽ null → permission-denied. Lưu local tạm.');
    cacheLessonLocal(courseId, lessonId, data);
    return false;
  }
  const userId = auth.currentUser.uid;
  const progressId = userId + '_' + courseId;
  let lessonSaved = false;

  // (1) Ghi document bài học vào subcollection "lessons" — TÁCH RIÊNG
  try {
    const lessonRef = doc(db, 'progress', progressId, 'lessons', lessonId);
    await setDoc(lessonRef, {
      lessonId: lessonId,
      status: data.status || 'doing',
      completedAt: data.status === 'done' ? serverTimestamp() : null,
      quizScore: data.quizScore != null ? data.quizScore : null,
      quizPassed: data.quizPassed || false,
      answeredQuestions: data.answeredQuestions || []
    }, { merge: true });
    lessonSaved = true;
    console.log('[Firestore] ✓ Đã ghi bài: progress/' + progressId + '/lessons/' + lessonId + ' (status=' + (data.status || 'doing') + ')');
  } catch(error){
    console.error('[Firestore] ✗ LỖI ghi bài học (subcollection lessons):', (error && error.code) || '', (error && error.message) || error);
    cacheLessonLocal(courseId, lessonId, data); // fallback localStorage
  }

  // (2) Cập nhật % khóa vào document chính — TÁCH RIÊNG (lỗi ở đây không làm mất bài đã ghi)
  try {
    await updateCourseProgress(userId, courseId);
  } catch(error){
    console.error('[Firestore] ✗ LỖI cập nhật % khóa (document chính):', (error && error.code) || '', (error && error.message) || error);
  }

  return lessonSaved;
}

// ── 2. Cập nhật % tiến độ khóa học ────────────────────────────
async function updateCourseProgress(userId, courseId){
  const progressId = userId + '_' + courseId;
  console.log('Auth user (cập nhật %):', auth.currentUser);
  const lessonsRef = collection(db, 'progress', progressId, 'lessons');
  const snapshot = await getDocs(lessonsRef);

  let total = 0, done = 0;
  snapshot.forEach(function(d){
    total++;
    if(d.data().status === 'done') done++;
  });
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  const progressRef = doc(db, 'progress', progressId);
  await setDoc(progressRef, {
    userId: userId,
    courseId: courseId,
    totalProgress: percent,
    lastAccess: serverTimestamp(),
    startedAt: serverTimestamp(),
    completedAt: percent === 100 ? serverTimestamp() : null
  }, { merge: true });

  // Cache vào localStorage để trang chủ đọc nhanh
  const local = JSON.parse(localStorage.getItem('lms_progress') || '{}');
  if(!local[courseId]) local[courseId] = {};
  local[courseId].totalProgress = percent;
  local[courseId].lastAccess = new Date().toISOString();
  localStorage.setItem('lms_progress', JSON.stringify(local));
}

// ── 3. Lấy tiến độ 1 khóa học ─────────────────────────────────
async function getCourseProgress(courseId){
  await whenAuthReady();
  const userId = getUserId();
  if(!userId) return null;
  const progressId = userId + '_' + courseId;
  try {
    const snap = await getDoc(doc(db, 'progress', progressId));
    if(snap.exists()) return snap.data();
  } catch(error){
    console.warn('Offline — đọc local:', error);
  }
  const local = JSON.parse(localStorage.getItem('lms_progress') || '{}');
  return local[courseId] || null;
}

// ── 4. Lấy tiến độ tất cả khóa (đọc cache localStorage cho nhanh) ──
async function getAllProgress(){
  const userId = getUserId();
  if(!userId) return {};
  return JSON.parse(localStorage.getItem('lms_progress') || '{}');
}

// ── 5. Lấy trạng thái 1 bài học ───────────────────────────────
async function getLessonStatus(courseId, lessonId){
  await whenAuthReady();
  const userId = getUserId();
  if(!userId) return 'locked';
  const progressId = userId + '_' + courseId;
  try {
    const snap = await getDoc(doc(db, 'progress', progressId, 'lessons', lessonId));
    if(snap.exists()) return snap.data().status;
  } catch(error){
    console.warn('Offline — đọc local:', error);
    const local = JSON.parse(localStorage.getItem('lms_progress') || '{}');
    const c = local[courseId];
    if(c && c.lessons && c.lessons[lessonId]) return c.lessons[lessonId].status;
  }
  return 'locked';
}

// ── 6. Lưu kết quả quiz ───────────────────────────────────────
async function saveQuizResult(courseId, lessonId, score, passed){
  await saveLessonProgress(courseId, lessonId, {
    status: passed ? 'done' : 'doing',
    quizScore: score,
    quizPassed: passed
  });
}

// Export ra global cho các trang dùng (script thường gọi được)
window.firestoreProgress = {
  saveLessonProgress,
  getCourseProgress,
  getAllProgress,
  getLessonStatus,
  saveQuizResult
};
