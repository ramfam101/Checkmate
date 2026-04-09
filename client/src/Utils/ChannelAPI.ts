const BASE = (import.meta.env.VITE_APP_API_BASE_URL ?? "").replace(/\/$/, "");

async function request(path: string, opts: RequestInit = {}) {
	const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
	const res = await fetch(url, { credentials: "include", ...opts });
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

export default {
	list: async (): Promise<{ id: string; name: string }[]> => {
		return request("/channels");
	},

	getById: async (id: string) => {
		return request(`/channels/${encodeURIComponent(id)}`);
	},
};
