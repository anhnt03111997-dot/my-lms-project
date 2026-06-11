// ── auth-role.js : phân quyền 3 cấp (admin / teacher / employee) dùng chung ──

// Lấy thông tin user từ localStorage
function getCurrentUser(){
  const raw = localStorage.getItem('lms_user');
  if(!raw) return null;
  try { return JSON.parse(raw); } catch(e){ return null; }
}

// Kiểm tra role
function isAdmin(){
  const u = getCurrentUser();
  return !!(u && u.role === 'admin');
}
function isTeacher(){
  const u = getCurrentUser();
  return !!(u && (u.role === 'teacher' || u.role === 'admin'));
}
function isEmployee(){
  const u = getCurrentUser();
  return u !== null;
}

// Badge role hiển thị cạnh tên trên navbar
function getRoleBadge(role){
  const badges = {
    admin:   '<span style="background:#EF4444;color:white;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;">Admin</span>',
    teacher: '<span style="background:#3B82F6;color:white;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:6px;">Giảng viên</span>',
    employee:''
  };
  return badges[role] || '';
}

// Áp dụng phân quyền khi load trang
function applyRolePermissions(){
  const u = getCurrentUser();
  if(!u){ window.location.href = 'login.html'; return; }

  // Hiện tên + badge role trên navbar
  const greet = document.querySelector('.greeting');
  if(greet){ greet.innerHTML = 'Xin chào, <b>' + u.name + '</b>' + getRoleBadge(u.role); }

  const av = document.querySelector('.nav-right .avatar');
  if(av && u.name){ av.textContent = u.name.charAt(0).toUpperCase(); }

  // Ẩn/hiện phần tử theo role
  // Admin: thấy mọi thứ | Teacher: thấy teacher + employee | Employee: chỉ employee
  document.querySelectorAll('[data-role-admin]').forEach(function(el){
    el.style.display = isAdmin() ? '' : 'none';
  });
  document.querySelectorAll('[data-role-teacher]').forEach(function(el){
    el.style.display = isTeacher() ? '' : 'none';
  });
}

// Đăng xuất: signOut Firebase thật rồi xóa localStorage + về login
// (tự khởi tạo Firebase app nếu trang chưa init, đảm bảo signOut hiệu lực ở mọi trang)
function handleLogout(){
  function done(){
    localStorage.removeItem('lms_user');
    window.location.href = 'login.html';
  }
  Promise.all([
    import('https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js')
  ]).then(function(mods){
    const appMod = mods[0], authMod = mods[1];
    const cfg = {
      apiKey: "AIzaSyDx85zsy3UfYyjV9raZLY0knwIwho8UhLg",
      authDomain: "amela-lms.firebaseapp.com",
      projectId: "amela-lms",
      storageBucket: "amela-lms.firebasestorage.app",
      messagingSenderId: "833013103244",
      appId: "1:833013103244:web:80ea9e14f887b50e4bd9a9"
    };
    let app;
    try { app = appMod.getApp(); } catch(e){ app = appMod.initializeApp(cfg); }
    return authMod.signOut(authMod.getAuth(app)).finally(done);
  }).catch(function(error){
    console.warn('Lỗi đăng xuất:', error);
    done();
  });
}
