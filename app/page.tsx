import { RaidApp } from "./components/RaidApp";
import { demoData } from "../lib/demo-data";

export default function Home() {
  return <RaidApp initialData={demoData} />;
}
