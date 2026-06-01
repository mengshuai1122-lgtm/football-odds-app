import React, { useState } from "react";
import { supabase } from "./supabase";

export default function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) {
      alert("请输入邮箱和密码");
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);

    if (error) {
      alert("登录失败：" + error.message);
      return;
    }

    onLogin(data.user);
  }

  return (
    <div style={pageStyle}>
      <div style={boxStyle}>
        <h1 style={{ marginBottom: 8 }}>AI足球盘口监控系统</h1>
        <p style={{ color: "#94a3b8", marginBottom: 20 }}>用户登录</p>

        <input
          style={inputStyle}
          placeholder="邮箱"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          style={inputStyle}
          placeholder="密码"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleLogin();
          }}
        />

        <button style={buttonStyle} onClick={handleLogin} disabled={loading}>
          {loading ? "登录中..." : "登录"}
        </button>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  background: "#111827",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  color: "white",
  fontFamily: "Arial",
  padding: 20,
};

const boxStyle = {
  background: "#1f2937",
  padding: 30,
  borderRadius: 16,
  width: "100%",
  maxWidth: 380,
  textAlign: "center",
  boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  marginTop: 14,
  borderRadius: 8,
  border: "1px solid #334155",
  background: "#0f172a",
  color: "white",
  fontSize: 16,
};

const buttonStyle = {
  width: "100%",
  padding: 12,
  marginTop: 20,
  borderRadius: 8,
  border: "none",
  background: "#22c55e",
  color: "white",
  fontSize: 16,
  cursor: "pointer",
};
