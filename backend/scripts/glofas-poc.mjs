/**
 * PoC — GloFAS river-discharge via the Copernicus EWDS (Early Warning Data Store).
 * ===========================================================================
 * WHY: the Risk Engine's strongest input (river_water_level, weight 0.6) is NULL
 * because `flood-api.open-meteo.com` is TCP-blocked from this network and no free
 * proxy can reach it. GloFAS is the SAME underlying model Open-Meteo Flood serves,
 * and its source — Copernicus EWDS — IS reachable from here (verified: the
 * /processes catalogue lists `cems-glofas-forecast`). This script is the reachable
 * path to real river data.
 *
 * WHAT it does (OGC API – Processes flow, all over plain global fetch, no deps):
 *   1. POST an execution request for `cems-glofas-forecast` over a Vietnam bbox.
 *   2. Poll the async job until it succeeds.
 *   3. Resolve + download the result asset (GRIB2).
 *   4. Explain the per-station extraction step (the one piece Node can't do well).
 *
 * RUN:
 *   1. Register (free) at https://ewds.climate.copernicus.eu → Your profile →
 *      copy the Personal Access Token (PAT).
 *   2. EWDS_PAT=<token> node scripts/glofas-poc.mjs
 *
 * NOTE ON UNITS: GloFAS returns river DISCHARGE (m³/s), not water LEVEL (m) — the
 * same proxy the Open-Meteo Flood integration already used for `river_water_level`.
 * Keep that caveat when feeding it to the threshold model.
 */

const BASE = process.env.EWDS_URL ?? 'https://ewds.climate.copernicus.eu/api/retrieve/v1';
const PROCESS_ID = 'cems-glofas-forecast';
const PAT = process.env.EWDS_PAT;

// Vietnam bounding box [North, West, South, East] for the GloFAS subset.
const VN_AREA = [24, 102, 8, 110];
// Optional: a few stations to illustrate nearest-grid-cell extraction (lat,lon).
const SAMPLE_STATIONS = [
  { code: 'ST_00001', lat: 21.03, lon: 105.85 },
  { code: 'ST_00003', lat: 16.46, lon: 107.59 },
];

function todayUTC() {
  const d = new Date();
  return {
    year: String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1).padStart(2, '0'),
    day: String(d.getUTCDate()).padStart(2, '0'),
  };
}

function authHeaders() {
  // EWDS (cads) accepts the Personal Access Token via the PRIVATE-TOKEN header.
  return { 'PRIVATE-TOKEN': PAT, 'Content-Type': 'application/json', Accept: 'application/json' };
}

async function submit() {
  const { year, month, day } = todayUTC();
  const body = {
    inputs: {
      system_version: 'operational',
      hydrological_model: 'lisflood',
      product_type: 'control_forecast',
      variable: 'river_discharge_in_the_last_24_hours',
      year,
      month,
      day,
      leadtime_hour: ['24', '48', '72', '96', '120'],
      data_format: 'grib2',
      download_format: 'unarchived',
      area: VN_AREA,
    },
  };
  const res = await fetch(`${BASE}/processes/${PROCESS_ID}/execution`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`submit failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  const job = JSON.parse(text);
  const jobId = job.jobID ?? job.id;
  console.log(`[submit] job ${jobId} status=${job.status}`);
  return jobId;
}

async function poll(jobId, { tries = 60, intervalMs = 10000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${BASE}/jobs/${jobId}`, { headers: authHeaders() });
    const job = await res.json();
    console.log(`[poll ${i}] status=${job.status}`);
    if (job.status === 'successful') return job;
    if (job.status === 'failed') throw new Error(`job failed: ${JSON.stringify(job).slice(0, 300)}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('job did not finish within the polling window');
}

async function resolveAsset(jobId) {
  const res = await fetch(`${BASE}/jobs/${jobId}/results`, { headers: authHeaders() });
  const results = await res.json();
  // Result shape: { asset: { value: { href, ... } } } (cads/ogc-api-processes).
  const href = results?.asset?.value?.href ?? results?.asset?.href;
  if (!href) throw new Error(`no asset href in results: ${JSON.stringify(results).slice(0, 300)}`);
  return href;
}

async function download(href, outPath) {
  const res = await fetch(href, { headers: { 'PRIVATE-TOKEN': PAT } });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outPath, buf);
  console.log(`[download] saved ${buf.length} bytes -> ${outPath}`);
  return outPath;
}

async function main() {
  if (!PAT) {
    console.error(
      'EWDS_PAT not set. Register (free) at https://ewds.climate.copernicus.eu,\n' +
        'copy your Personal Access Token, then:  EWDS_PAT=<token> node scripts/glofas-poc.mjs',
    );
    process.exit(2);
  }
  console.log(`GloFAS PoC → ${BASE} (process ${PROCESS_ID}), bbox ${VN_AREA}`);
  const jobId = await submit();
  await poll(jobId);
  const href = await resolveAsset(jobId);
  const out = `glofas-${todayUTC().year}${todayUTC().month}${todayUTC().day}.grib2`;
  await download(href, out);

  console.log('\n--- NEXT: per-station extraction (the one step Node can\'t do well) ---');
  console.log(
    'GloFAS output is a gridded GRIB2 field (river discharge, ~0.05° cells). To turn it\n' +
      'into per-station values, take each station\'s nearest grid cell. Pure-Node GRIB\n' +
      'decoding is impractical; use a tiny Python sidecar (cfgrib/xarray):\n',
  );
  console.log('  import xarray as xr');
  console.log(`  ds = xr.open_dataset('${`glofas-...grib2`}', engine='cfgrib')`);
  for (const s of SAMPLE_STATIONS) {
    console.log(
      `  ${s.code}: ds['dis24'].sel(latitude=${s.lat}, longitude=${s.lon}, method='nearest')`,
    );
  }
  console.log(
    '\nThen POST the {stationId -> discharge[]} back to an internal endpoint, OR have a\n' +
      'GlofasProvider run this as a DAILY batch and write river_water_level (proxy) into\n' +
      'weather_forecasts — replacing the blocked Open-Meteo Flood call. GloFAS is daily,\n' +
      'so a daily cron (not the hourly forecast cron) is the right cadence.',
  );
}

main().catch((e) => {
  console.error('PoC error:', e.message);
  process.exit(1);
});
