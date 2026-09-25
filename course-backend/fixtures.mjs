// Public, in-memory teaching fixtures. Never deploy as institutional authentication.
// These defaults are fictional course fixtures (not secrets). For any other
// environment, override them through environment variables instead of editing
// token strings directly in source code.
const env = process.env;

export const FIXTURE_ACCESS_TOKEN = env.COURSE_FIXTURE_TOKEN ?? 'course-valid-token';
export const FIXTURE_REFRESH_TOKEN = env.COURSE_FIXTURE_REFRESH_TOKEN ?? 'course-refresh-0';
export const FIXTURE_REFRESH_TOKEN_NEXT = env.COURSE_FIXTURE_REFRESH_TOKEN_NEXT ?? 'course-refresh-1';