import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

const worker = new Worker();
export default worker;

// Strava app credentials are read from runtime secrets (set via
// `npx workers secrets set STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_BOOTSTRAP_REFRESH_TOKEN=...`).
// See the README "secrets" section.
function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required secret: ${name}. Set it with \`npx workers secrets set ${name}=...\``);
	}
	return value;
}

// Manually refresh the Strava access token and return both the new access
// token and the rotated refresh token. Strava rotates refresh tokens on
// every call, so we always persist the latest one in state.
async function refreshStravaToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
	const response = await fetch("https://www.strava.com/oauth/token", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: requireEnv("STRAVA_CLIENT_ID"),
			client_secret: requireEnv("STRAVA_CLIENT_SECRET"),
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});

	if (!response.ok) {
		throw new Error(`Strava token refresh failed: ${response.status} ${response.statusText}`);
	}

	const data = await response.json() as { access_token: string; refresh_token: string };
	return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

// Strava API types
interface StravaActivity {
	id: number;
	name: string;
	type: string;
	sport_type: string;
	start_date: string;       // UTC
	start_date_local: string; // local time of athlete
	moving_time: number; // seconds
	elapsed_time: number; // seconds
	distance: number; // meters
	average_heartrate?: number;
	calories?: number;
	average_speed?: number; // meters per second
}

interface SyncState {
	page: number;
	after: number; // Unix timestamp - either 14 days ago (first run) or last sync time
	refreshToken: string; // Rotated on every sync to stay permanently valid
}

// Helper to format duration in minutes
function formatDuration(seconds: number): number {
	return Math.round(seconds / 60);
}

// Helper to extract time from a local ISO 8601 date string (start_date_local)
function formatStartTime(localIsoDateString: string): string {
	// start_date_local is already in the athlete's local time, e.g. "2026-03-24T18:22:08Z"
	// Parse the time portion directly to avoid timezone shifts
	const match = localIsoDateString.match(/T(\d{2}):(\d{2})/);
	if (!match) return "";
	const hours = parseInt(match[1]);
	const minutes = match[2];
	const ampm = hours >= 12 ? "pm" : "am";
	const displayHour = hours % 12 || 12;
	return `${displayHour}:${minutes} ${ampm}`;
}

// Helper to convert meters to miles
function metersToMiles(meters: number): number {
	return Math.round((meters / 1609.344) * 100) / 100;
}

// Helper to format pace as mm:ss /mi
function formatPace(metersPerSecond: number): string {
	if (!metersPerSecond || metersPerSecond === 0) return "N/A";
	// Convert m/s to minutes per mile
	const minutesPerMile = 26.8224 / metersPerSecond;
	const minutes = Math.floor(minutesPerMile);
	const seconds = Math.round((minutesPerMile - minutes) * 60);
	return `${minutes}:${seconds.toString().padStart(2, "0")} /mi`;
}

// Helper to check if activity type has distance/pace
function hasDistanceMetrics(type: string): boolean {
	const distanceTypes = [
		"Run",
		"Walk",
		"Ride",
		"Hike",
		"VirtualRun",
		"VirtualRide",
		"TrailRun",
		"Swim",
	];
	return distanceTypes.includes(type);
}

// Fetch activities from Strava API
async function fetchStravaActivities(
	accessToken: string,
	page: number,
	after: number,
	perPage: number = 50
): Promise<StravaActivity[]> {
	const url = new URL("https://www.strava.com/api/v3/athlete/activities");
	url.searchParams.set("page", page.toString());
	url.searchParams.set("per_page", perPage.toString());
	url.searchParams.set("after", after.toString());

	const response = await fetch(url.toString(), {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!response.ok) {
		throw new Error(
			`Strava API error: ${response.status} ${response.statusText}`
		);
	}

	return response.json();
}

// Helper to get emoji for activity type
function getActivityEmoji(type: string): string {
	const emojiMap: Record<string, string> = {
		Run: "🏃",
		Walk: "🚶",
		WeightTraining: "🏋️",
		Workout: "💪",
		Ride: "🚴",
		Hike: "🥾",
		Swim: "🏊",
		VirtualRun: "🏃",
		VirtualRide: "🚴",
		TrailRun: "🏃",
		Yoga: "🧘",
		HIIT: "🔥",
		Crossfit: "🏋️",
		Elliptical: "🏃",
		StairStepper: "🪜",
		RockClimbing: "🧗",
		Boxing: "🥊",
	};
	return emojiMap[type] ?? "🏅";
}

// Strava Activities Sync - syncs workouts from Strava to Notion
worker.sync("stravaActivitiesSync", {
	primaryKeyProperty: "Activity ID",
	schedule: "3h",
	mode: "incremental",

	schema: {
		defaultName: "Strava Activities",
		databaseIcon: Builder.emojiIcon("🏃"),
		properties: {
			Name: Schema.title(),
			"Activity ID": Schema.richText(),
			"Activity Type": Schema.select([
				{ name: "Run", color: "green" },
				{ name: "Walk", color: "blue" },
				{ name: "WeightTraining", color: "purple" },
				{ name: "Workout", color: "purple" },
				{ name: "Ride", color: "orange" },
				{ name: "Hike", color: "brown" },
				{ name: "Swim", color: "blue" },
				{ name: "VirtualRun", color: "green" },
				{ name: "VirtualRide", color: "orange" },
				{ name: "TrailRun", color: "green" },
				{ name: "Yoga", color: "pink" },
				{ name: "HIIT", color: "red" },
				{ name: "Crossfit", color: "red" },
				{ name: "Elliptical", color: "yellow" },
				{ name: "StairStepper", color: "yellow" },
				{ name: "RockClimbing", color: "brown" },
				{ name: "Boxing", color: "red" },
				{ name: "Other", color: "gray" },
			]),
			Date: Schema.date(),
			"Start Time": Schema.richText(),
			Duration: Schema.richText(),
			Calories: Schema.richText(),
			"Average Heart Rate": Schema.richText(),
			Distance: Schema.richText(),
			Pace: Schema.richText(),
		},
	},

	execute: async (state: SyncState | undefined) => {
		// Use the refresh token from state, falling back to the bootstrap token on first run.
		// We refresh on every execution so the rotated token is always saved to state.
		const currentRefreshToken = state?.refreshToken ?? requireEnv("STRAVA_BOOTSTRAP_REFRESH_TOKEN");
		const { accessToken, refreshToken: newRefreshToken } = await refreshStravaToken(currentRefreshToken);

		// Always look back at least 14 days to catch manual entries and gaps
		const fourteenDaysAgo = Math.floor(Date.now() / 1000) - 14 * 24 * 60 * 60;

		const page = state?.page ?? 1;
		const isFirstCycle = state?.page === undefined;
		// Use the earlier of: saved cursor or 14 days ago — ensures we never miss recent activities
		const after = isFirstCycle ? fourteenDaysAgo : Math.min(state?.after ?? fourteenDaysAgo, fourteenDaysAgo);

		const activities = await fetchStravaActivities(accessToken, page, after, 50);

		const changes = activities.map((activity) => {
			const hasDistance = hasDistanceMetrics(activity.type);
			const distanceValue =
				hasDistance && activity.distance > 0
					? `${metersToMiles(activity.distance)} mi`
					: "N/A";
			const paceValue =
				hasDistance && activity.average_speed
					? formatPace(activity.average_speed)
					: "N/A";
			const heartRateValue = activity.average_heartrate
				? `${Math.round(activity.average_heartrate)} bpm`
				: "N/A";

			return {
				type: "upsert" as const,
				key: activity.id.toString(),
				icon: Builder.emojiIcon(getActivityEmoji(activity.type)),
				properties: {
					Name: Builder.title(activity.name),
					"Activity ID": Builder.richText(activity.id.toString()),
					"Activity Type": Builder.select(activity.type),
					Date: Builder.date(activity.start_date_local.split("T")[0]),
					"Start Time": Builder.richText(formatStartTime(activity.start_date_local)),
					Duration: Builder.richText(`${formatDuration(activity.moving_time)} minutes`),
					Calories: Builder.richText(activity.calories ? `${activity.calories}` : "N/A"),
					"Average Heart Rate": Builder.richText(heartRateValue),
					Distance: Builder.richText(distanceValue),
					Pace: Builder.richText(paceValue),
				},
			};
		});

		// If we got a full page of results, there might be more on this pagination cycle
		const hasMore = activities.length === 50;

		// For next sync cycle, use current time as the "after" timestamp
		const currentTime = Math.floor(Date.now() / 1000);

		return {
			changes,
			hasMore,
			// Always persist the rotated refresh token alongside pagination state
			nextState: hasMore
				? { page: page + 1, after, refreshToken: newRefreshToken }
				: { page: 1, after: currentTime, refreshToken: newRefreshToken },
		};
	},
});
