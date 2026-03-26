"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ProfilePage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setError("Chưa đăng nhập. Vào /login");
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", u.user.id)
        .single();

      if (error) setError(error.message);
      setData(profile);
    })();
  }, []);

  return (
    <pre style={{ padding: 24, whiteSpace: "pre-wrap" }}>
      {error ? error : JSON.stringify(data, null, 2)}
    </pre>
  );
}
