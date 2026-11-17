import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getClubConfiguration } from "@/server/club-configuration.functions";

export function useClubConfiguration() {
  const get = useServerFn(getClubConfiguration);
  return useQuery({ queryKey: ["club-configuration"], queryFn: () => get(), staleTime: 30000, refetchInterval: 30000 });
}
export function ClubInformation() {
  const { data } = useClubConfiguration();
  if (!data || (!data.rules && !data.socialLinks.length)) return null;
  return <section className="border-t border-border px-4 py-6">
    <div className="mx-auto max-w-7xl space-y-4">
      {data.rules && <div><h2 className="font-display text-lg text-gold">Club rules</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground">{data.rules}</p></div>}
      <nav aria-label="Club social links" className="flex flex-wrap gap-4">{data.socialLinks.map((link, i) => <a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm text-gold underline-offset-4 hover:underline">{link.label}</a>)}</nav>
    </div>
  </section>;
}