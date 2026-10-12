declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: {
				id: number;
				username: string;
				displayName: string;
				mustChangePassword: number;
				role: 'admin' | 'member';
			} | null;
			/** Home Assistant Ingress prefix ("" when accessed directly). */
			base: string;
			/** Home Assistant user of a trusted Ingress request, for automatic sign-in. */
			haUser: import('$lib/server/ingress').HaUser | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
