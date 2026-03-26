"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function MePage() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setData(data));
  }, []);

  return (
    <pre style={{ padding: 24, whiteSpace: "pre-wrap" }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
