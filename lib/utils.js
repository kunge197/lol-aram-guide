import championsData from "@/data/champions.json";
import typesData from "@/data/types.json";

export function getChampions() {
  return championsData;
}

export function getChampionById(id) {
  return championsData.find((c) => c.id === id) || null;
}

export function getChampionTypes() {
  return typesData;
}

export function getChampionTypeName(typeId) {
  const type = typesData.find((t) => t.id === typeId);
  return type ? type.name : typeId;
}

export function searchChampions(query) {
  if (!query || query.trim() === "") return [];

  const q = query.trim().toLowerCase();
  return championsData.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.nameEn.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.aliases.some((alias) => alias.toLowerCase().includes(q))
  );
}

export function getChampionsByType(typeId) {
  return championsData.filter((c) => c.types.includes(typeId));
}

export function getChampionsWithBuilds() {
  return championsData.filter((c) => c.builds && c.builds.length > 0);
}
