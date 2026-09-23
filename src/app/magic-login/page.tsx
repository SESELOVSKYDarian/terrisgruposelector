import { MagicLoginForm } from "./magic-login-form";

export default async function MagicLoginPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <MagicLoginForm token={token ?? ""} />;
}
