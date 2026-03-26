export default function Page() {
  return (
    <pre style={{ padding: 24 }}>
      URL: {process.env.NEXT_PUBLIC_SUPABASE_URL ?? "MISSING"}
    </pre>
  );
}

