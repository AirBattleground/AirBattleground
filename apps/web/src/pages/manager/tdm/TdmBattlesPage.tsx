import { TournamentsList } from "@/pages/manager/tournaments/TournamentsPage";

/** /manager/tdm: the manager's TDM battles (knockout tournaments, mode "TDM"). Detail pages are the tournament ones. */
export default function TdmBattlesPage() {
  return <TournamentsList mode="TDM" />;
}
