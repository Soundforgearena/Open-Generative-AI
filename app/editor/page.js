import { redirect } from 'next/navigation';

// The legacy sample editor is replaced by the AI Video Creation Studio.
export default async function EditorPage({ searchParams }) {
  const params = await searchParams;
  const project = typeof params?.project === 'string' ? `?project=${encodeURIComponent(params.project)}` : '';
  redirect(`/studio${project}`);
}
