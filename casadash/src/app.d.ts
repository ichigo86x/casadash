declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: {
				id: number;
				username: string;
				displayName: string;
				mustChangePassword: number;
			} | null;
			/** Home Assistant Ingress prefix ("" when accessed directly). */
			base: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
