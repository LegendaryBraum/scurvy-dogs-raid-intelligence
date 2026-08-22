import { RaidApp } from "./components/RaidApp";
import { raidData } from "../lib/raid-data";

export default function Home() {
  return <RaidApp initialData={raidData} />;
}
