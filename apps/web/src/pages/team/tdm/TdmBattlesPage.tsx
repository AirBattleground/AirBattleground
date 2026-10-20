import { TournamentsList } from "@/pages/team/tournaments/TournamentsPage";

/** /team/tdm: TDM battles (knockout tournaments, mode "TDM"). The hub is the tournament one. */
export default function TdmBattlesPage() {
  return <TournamentsList mode="TDM" />;
}
