// Fetches all items for each Roblox group via cursor pagination and writes data.json.
// Run locally: node scripts/update.mjs
import { writeFile } from "node:fs/promises";

const GROUP_IDS = [32663795, 799946898, 33459419, 34114424, 16114977, 564029410];
const SORT = { latest: 3, bestSelling: 2, favorited: 1 };
const MAX_PAGES_PER_GROUP = 5; // Fetches up to 150 items per group per sort type

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  for (let i = 1; i <= 8; i++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (res.status === 429) { 
      console.log(`Rate limited (429) on ${url}. Retrying in ${5 * i} seconds...`);
      await sleep(5000 * i); 
      continue; 
    }
    throw new Error(`${res.status} for ${url}`);
  }
  throw new Error(`Rate limited: ${url}`);
}

function getCategory(thumbUrl) {
  const url = (thumbUrl || "").toLowerCase();
  if (url.includes("/hairaccessory/")) return "Hair";
  if (url.includes("/hat/")) return "Hats";
  if (url.includes("/faceaccessory/")) return "Face Accessories";
  if (url.includes("/backaccessory/")) return "Back Accessories";
  if (url.includes("/frontaccessory/")) return "Front Accessories";
  if (url.includes("/waistaccessory/")) return "Waist Accessories";
  if (url.includes("/neckaccessory/")) return "Neck Accessories";
  if (url.includes("/shoulderaccessory/")) return "Shoulder Accessories";
  if (url.includes("/emoteanimation/")) return "Emotes";
  if (url.includes("/tshirtaccessory/") || url.includes("/shirt/") || url.includes("/pants/")) return "Clothing";
  return "Other Accessories";
}

async function fetchAllItemsForGroup(groupId, sort) {
  let allItems = [];
  let cursor = "";
  let page = 0;

  while (page < MAX_PAGES_PER_GROUP) {
    const cursorParam = cursor ? `&cursor=${cursor}` : "";
    const url = `https://catalog.roblox.com/v1/search/items/details?CreatorTargetId=${groupId}&CreatorType=Group&SortType=${sort}&Limit=30${cursorParam}`;
    const json = await get(url);
    await sleep(1000);

    const pageItems = (json.data || []).map((i) => ({
      id: i.id,
      name: i.name,
      favorites: i.favoriteCount ?? 0,
      price: i.price ?? i.lowestPrice ?? null,
      priceStatus: i.priceStatus ?? null,
      description: i.description ?? "",
      creator: i.creatorName ?? null,
    }));

    allItems.push(...pageItems);
    cursor = json.nextPageCursor;
    page++;

    if (!cursor) break; // Reached the last page for this group
  }

  return allItems;
}

const groups = [];
for (const id of GROUP_IDS) {
  const info = await get(`https://groups.roblox.com/v1/groups/${id}`);
  await sleep(1000);
  const latest = await fetchAllItemsForGroup(id, SORT.latest);
  const bestSelling = await fetchAllItemsForGroup(id, SORT.bestSelling);
  const favorited = (await fetchAllItemsForGroup(id, SORT.favorited)).sort((a, b) => b.favorites - a.favorites);
  groups.push({ id, name: info.name, latest, bestSelling, favorited });
  console.log(`${info.name}: Fetched ${latest.length} items across pages successfully.`);
}

// Extract unique asset IDs to fetch thumbnails
const ids = [...new Set(groups.flatMap((g) => [...g.latest, ...g.bestSelling, ...g.favorited].map((i) => i.id)))];
const thumbs = {};
for (let i = 0; i < ids.length; i += 100) {
  const batch = ids.slice(i, i + 100).join(",");
  const json = await get(`https://thumbnails.roblox.com/v1/assets?assetIds=${batch}&size=420x420&format=Png&isCircular=false`);
  for (const t of json.data || []) thumbs[t.targetId] = t.imageUrl;
  await sleep(1000);
}

// Assign thumbnails and category mappings
for (const g of groups) {
  for (const row of [g.latest, g.bestSelling, g.favorited]) {
    for (const item of row) {
      item.image = thumbs[item.id] || null;
      item.category = getCategory(item.image);
    }
  }
}

await writeFile("data.json", JSON.stringify({ updated: new Date().toISOString(), groups }, null, 1));
console.log("Wrote complete data.json with all catalog items!");