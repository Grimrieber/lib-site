import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ realm: string; name: string }>;
};

// Tab content moved into the parent layout (rendered server-side once,
// toggled client-side via URL hash). This subroute exists only for
// backwards compat — old links redirect to /character/X#dungeons.
export default async function DungeonsTabRedirect({ params }: Props) {
  const { realm, name } = await params;
  redirect(`/character/${realm}/${name}#dungeons`);
}
