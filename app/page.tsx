import { RaidApp } from "./components/RaidApp";
import { privatePlaceholderData } from "../lib/private-placeholder";

export default function Home() {
  return <RaidApp initialData={privatePlaceholderData} />;
}
