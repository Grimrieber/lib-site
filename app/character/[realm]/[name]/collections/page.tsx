import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ realm: string; name: string }>;
};

export default async function CollectionsTabRedirect({ params }: Props) {
  const { realm, name } = await params;
  redirect(`/character/${realm}/${name}#collections`);
}
