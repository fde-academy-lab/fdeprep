/**
 * Who the seed enrols. Data only, so a reviewer can read the cohort in one
 * screen and a test can count it.
 *
 * Forty people in two cohorts, written to the shape the build brief fixes:
 * 14 builders, 18 navigators and 8 accelerators; one faculty member per
 * cohort and one admin besides the development account in seed-c3; two
 * enrolments paused and one ended. Staff keep the default persona, navigator,
 * and never practise, so they carry the `new` archetype.
 *
 * GitHub ids start at 100001 and run in list order, which keeps them clear of
 * the development account's 0 and of any real account a test database holds.
 * The names are made up and spread across the cohort's own locales.
 */
import type { Persona } from "../policy/roadmap.ts";

/**
 * How a learner works, which is what decides their rows.
 *
 *   steady    a sitting most weeks, one or two problems, mixed outcomes
 *   sprinter  bursts of three or four days, mostly clean passes, two rehearsals
 *   stalled   three or more failed submits on one problem and no pass there,
 *             which is the stuck list in docs/00 section 8
 *   lapsed    worked early on and has done nothing for weeks
 *   new       no attempts at all, so the zero state stays demonstrable
 */
export type Archetype = "steady" | "sprinter" | "stalled" | "lapsed" | "new";
export const ARCHETYPES: readonly Archetype[] = ["steady", "sprinter", "stalled", "lapsed", "new"];

export type CohortKey = "c3" | "c4";
export type Role = "learner" | "faculty" | "admin";
export type EnrolmentState = "active" | "paused" | "ended";

export interface SeedCohort {
  key: CohortKey;
  slug: string;
  name: string;
  /** The cohort's first day, counted back from the day the seed runs. */
  startsDaysAgo: number;
}

/** Slugs carry `seed-` so `--replace` can find its own rows and nothing else. */
export const COHORTS: readonly SeedCohort[] = [
  { key: "c3", slug: "seed-c3", name: "Cohort 3", startsDaysAgo: 92 },
  { key: "c4", slug: "seed-c4", name: "Cohort 4", startsDaysAgo: 21 },
];

export interface Person {
  login: string;
  displayName: string;
  githubId: number;
  cohort: CohortKey;
  persona: Persona;
  role: Role;
  state: EnrolmentState;
  archetype: Archetype;
  /** Joins by redeeming an invite rather than being on the roster from day one. */
  joinsByInvite?: boolean;
  /** Answers voice questions and never opens a problem. */
  voiceOnly?: boolean;
  /** One of the three learners whose readiness tests/fixtures/seed-readiness.ts works out by hand. */
  named?: 1 | 2 | 3;
  /** One of the six learners in the small plan the tests run. */
  inTestPlan?: boolean;
}

/**
 * The development account. developmentLearner() in lib/session/current.ts
 * signs in as the first active enrolment by id, so the seed enrols this one
 * before anybody else and AUTH_DEV_LEARNER=1 lands on an admin in seed-c3.
 */
export const DEVELOPMENT = {
  login: "dev",
  displayName: "Development learner",
  githubId: 0,
  cohort: "c3" as CohortKey,
  persona: "navigator" as Persona,
  role: "admin" as Role,
};

/** First id in the seed's range. `--replace` and the tests read it. */
export const FIRST_GITHUB_ID = 100001;

type Row = Omit<Person, "githubId">;

const ROWS: readonly Row[] = [
  // ------------------------------------------------------------ Cohort 3
  { login: "priya-raghavan", displayName: "Priya Raghavan", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "steady", named: 1, inTestPlan: true },
  { login: "tbakare", displayName: "Tunde Bakare", cohort: "c3", persona: "navigator",
    role: "learner", state: "active", archetype: "sprinter", named: 2, inTestPlan: true },
  { login: "maricel-dizon", displayName: "Maricel Dizon", cohort: "c3", persona: "accelerator",
    role: "learner", state: "active", archetype: "stalled", named: 3, inTestPlan: true },
  { login: "opennington", displayName: "Oliver Pennington", cohort: "c3", persona: "navigator",
    role: "learner", state: "active", archetype: "steady" },
  { login: "ananya-k", displayName: "Ananya Kulkarni", cohort: "c3", persona: "navigator",
    role: "learner", state: "active", archetype: "steady" },
  { login: "chidinma-okafor", displayName: "Chidinma Okafor", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "steady" },
  { login: "rhys-llewellyn", displayName: "Rhys Llewellyn", cohort: "c3", persona: "accelerator",
    role: "learner", state: "active", archetype: "steady" },
  { login: "jmwangi", displayName: "Joseph Mwangi", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "steady" },
  { login: "harpreet-sandhu", displayName: "Harpreet Sandhu", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "sprinter" },
  { login: "camille-arceo", displayName: "Camille Arceo", cohort: "c3", persona: "accelerator",
    role: "learner", state: "active", archetype: "sprinter" },
  { login: "emeka-nwosu", displayName: "Emeka Nwosu", cohort: "c3", persona: "navigator",
    role: "learner", state: "active", archetype: "sprinter" },
  { login: "sid-menon", displayName: "Siddharth Menon", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "stalled" },
  { login: "beavillanueva", displayName: "Bea Villanueva", cohort: "c3", persona: "navigator",
    role: "learner", state: "active", archetype: "stalled" },
  { login: "kofi-mensah", displayName: "Kofi Mensah", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "stalled" },
  { login: "lwhitfield", displayName: "Lauren Whitfield", cohort: "c3", persona: "navigator",
    role: "learner", state: "active", archetype: "lapsed" },
  { login: "rohan-deshpande", displayName: "Rohan Deshpande", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "lapsed" },
  { login: "adaeze-eze", displayName: "Adaeze Eze", cohort: "c3", persona: "accelerator",
    role: "learner", state: "ended", archetype: "lapsed", inTestPlan: true },
  { login: "thanh-ng", displayName: "Thanh Nguyen", cohort: "c3", persona: "navigator",
    role: "learner", state: "paused", archetype: "lapsed" },
  { login: "fatima-bello", displayName: "Fatima Bello", cohort: "c3", persona: "builder",
    role: "learner", state: "active", archetype: "new" },
  { login: "gmoss", displayName: "Gareth Moss", cohort: "c3", persona: "navigator",
    role: "learner", state: "active", archetype: "new" },
  { login: "divya-pillai", displayName: "Divya Pillai", cohort: "c3", persona: "accelerator",
    role: "learner", state: "active", archetype: "new" },
  { login: "jcastillo-dev", displayName: "Jerome Castillo", cohort: "c3", persona: "navigator",
    role: "learner", state: "paused", archetype: "new" },
  { login: "meera-iyer", displayName: "Meera Iyer", cohort: "c3", persona: "navigator",
    role: "faculty", state: "active", archetype: "new" },
  { login: "daniel-osei", displayName: "Daniel Osei", cohort: "c3", persona: "navigator",
    role: "admin", state: "active", archetype: "new" },

  // ------------------------------------------------------------ Cohort 4
  { login: "aisha-abdullahi", displayName: "Aisha Abdullahi", cohort: "c4", persona: "navigator",
    role: "learner", state: "active", archetype: "steady" },
  { login: "karthik-subra", displayName: "Karthik Subramanian", cohort: "c4", persona: "builder",
    role: "learner", state: "active", archetype: "steady" },
  { login: "hannah-brooks", displayName: "Hannah Brooks", cohort: "c4", persona: "navigator",
    role: "learner", state: "active", archetype: "steady" },
  { login: "paolo-reyes", displayName: "Paolo Reyes", cohort: "c4", persona: "builder",
    role: "learner", state: "active", archetype: "steady" },
  { login: "nkechi-obi", displayName: "Nkechi Obi", cohort: "c4", persona: "accelerator",
    role: "learner", state: "active", archetype: "steady" },
  { login: "arjun-malhotra", displayName: "Arjun Malhotra", cohort: "c4", persona: "navigator",
    role: "learner", state: "active", archetype: "sprinter" },
  { login: "gracetan", displayName: "Grace Tan", cohort: "c4", persona: "builder",
    role: "learner", state: "active", archetype: "sprinter" },
  { login: "ibrahim-yusuf", displayName: "Ibrahim Yusuf", cohort: "c4", persona: "accelerator",
    role: "learner", state: "active", archetype: "sprinter" },
  { login: "neha-agarwal", displayName: "Neha Agarwal", cohort: "c4", persona: "builder",
    role: "learner", state: "active", archetype: "stalled" },
  { login: "callum-fraser", displayName: "Callum Fraser", cohort: "c4", persona: "navigator",
    role: "learner", state: "active", archetype: "stalled" },
  { login: "sinazo-dlamini", displayName: "Sinazo Dlamini", cohort: "c4", persona: "builder",
    role: "learner", state: "active", archetype: "lapsed" },
  { login: "lakshmi-n", displayName: "Lakshmi Narayanan", cohort: "c4", persona: "navigator",
    role: "learner", state: "active", archetype: "lapsed" },
  { login: "ruth-adeyemi", displayName: "Ruth Adeyemi", cohort: "c4", persona: "builder",
    role: "learner", state: "active", archetype: "new", joinsByInvite: true, voiceOnly: true,
    inTestPlan: true },
  { login: "mateus-costa", displayName: "Mateus Costa", cohort: "c4", persona: "accelerator",
    role: "learner", state: "active", archetype: "new", joinsByInvite: true, inTestPlan: true },
  { login: "joy-bautista", displayName: "Joy Bautista", cohort: "c4", persona: "navigator",
    role: "learner", state: "active", archetype: "new" },
  { login: "imran-qureshi", displayName: "Imran Qureshi", cohort: "c4", persona: "navigator",
    role: "faculty", state: "active", archetype: "new" },
];

export const PEOPLE: readonly Person[] = ROWS.map((row, index) => ({
  ...row, githubId: FIRST_GITHUB_ID + index,
}));

/** Practises problems: a learner with an archetype that has rows behind it. */
export function practises(person: Person): boolean {
  return person.role === "learner" && person.archetype !== "new";
}
