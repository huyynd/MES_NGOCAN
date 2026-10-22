import React, { useState } from "react";
import { auth, setToken } from "./mesApi.js";
import { inputCls, toast } from "./ui.js";
import { Logo } from "./components.jsx";

export default function Login({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await auth.login({ username: u, password: p });
      setToken(r.token);
      toast.success("Đăng nhập thành công");
      onLogin(r.user);
    } catch (e) { setErr(e.message || "Đăng nhập thất bại"); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 shadow-sm w-full max-w-sm p-8 space-y-5">
        <div className="text-center">
          <Logo className="h-12 w-auto mx-auto" />
          <h1 className="text-lg font-bold text-slate-800 mt-3">Hệ thống MES</h1>
          <p className="text-xs text-slate-400">Bao Bì Ngọc An Thư</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">Tài khoản</label>
          <input className={inputCls} value={u} onChange={(e) => setU(e.target.value)} autoFocus placeholder="vd: admin" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1.5">Mật khẩu</label>
          <input type="password" className={inputCls} value={p} onChange={(e) => setP(e.target.value)} />
        </div>
        {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
        <button className="btn-primary w-full justify-center" disabled={loading}>{loading ? "Đang đăng nhập…" : "Đăng nhập"}</button>
      </form>
    </div>
  );
}
