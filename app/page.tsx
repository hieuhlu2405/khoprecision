export default function Page() {
  const keys = Object.keys(process.env).filter((k) => k.includes("SUPABASE"));
  return (
    <pre style={{ padding: 24 }}>
      {JSON.stringify(
        {
          hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
          keys,
        },
        null,
        2
      )}
    </pre>
  );
}
