const BASE = (import.meta.env.VITE_APP_API_BASE_URL ?? "").replace(/\/$/, "");

async function request(path: string, opts: RequestInit = {}) {
	const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
	const res = await fetch(url, { credentials: "include", ...opts });
	if (!res.ok) throw new Error(await res.text());
	return res.json();
}

export default {
	getForMonitor: async (monitorId: string) => {
		return request(`/notifications?monitorId=${encodeURIComponent(monitorId)}`);
	},

	getById: async (id: string) => {
		return request(`/notifications/${encodeURIComponent(id)}`);
	},

	update: async (id: string, payload: any) => {
		return request(`/notifications/${encodeURIComponent(id)}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	},

	create: async (payload: any) => {
		return request(`/notifications`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
	},

	delete: async (id: string) => {
		return request(`/notifications/${encodeURIComponent(id)}`, { method: "DELETE" });
	},
};
