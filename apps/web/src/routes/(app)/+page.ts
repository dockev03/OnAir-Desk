import { redirect } from '@sveltejs/kit';

// La page d'accueil des comptes est la bibliothèque de scripts.
export const load = () => redirect(307, '/scripts');
