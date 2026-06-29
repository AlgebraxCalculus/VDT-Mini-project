#!/usr/bin/env python3
"""
GloFAS GRIB -> per-station river discharge extractor (sidecar for GlofasProvider).

Pure-Node can't decode GRIB, so the Node provider shells out to this script.

USAGE:
    python3 glofas_extract.py <path-to.grib2>
    # stations JSON on stdin: [{"stationId":1,"latitude":21.03,"longitude":105.85}, ...]

OUTPUT (stdout): {"1":[{"date":"2026-06-28","discharge":1234.5}, ...], ...}

DEPENDENCIES (installed in the API image): python3 + python3-cfgrib + python3-xarray
+ libeccodes-dev (the apt `ecmwflibs` stub is removed so gribapi uses real findlibs).

Selection is VECTORISED: one nearest-neighbour .sel over all stations at once
(a per-station Python loop is far too slow at ~10k stations and trips the
provider's exec timeout). GloFAS variable is river discharge in the last 24h
(cfgrib name usually 'dis24'); auto-detected if it differs.
"""
import json
import sys


def to_date(v) -> str:
    try:
        return str(v)[:10]
    except Exception:  # noqa: BLE001
        return ""


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: glofas_extract.py <grib>", file=sys.stderr)
        return 2
    grib_path = sys.argv[1]

    try:
        stations = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        print(f"bad stations JSON on stdin: {e}", file=sys.stderr)
        return 2
    if not stations:
        json.dump({}, sys.stdout)
        return 0

    try:
        import numpy as np  # type: ignore
        import xarray as xr  # type: ignore
    except Exception as e:  # noqa: BLE001
        print(f"numpy/xarray/cfgrib not installed: {e}", file=sys.stderr)
        return 3

    try:
        ds = xr.open_dataset(grib_path, engine="cfgrib")
    except Exception as e:  # noqa: BLE001
        print(f"failed to open GRIB: {e}", file=sys.stderr)
        return 4

    var = "dis24" if "dis24" in ds.data_vars else next(iter(ds.data_vars))
    da = ds[var]

    # Per-step valid dates (GloFAS forecast steps are daily).
    if "valid_time" in da.coords:
        vt = np.atleast_1d(da["valid_time"].values).ravel()
    elif "step" in da.coords and "time" in ds.coords:
        vt = (np.atleast_1d(ds["time"].values) + np.atleast_1d(da["step"].values)).ravel()
    elif "time" in da.coords:
        vt = np.atleast_1d(da["time"].values).ravel()
    else:
        vt = np.array([None])
    dates = [to_date(v) for v in vt]

    # Vectorised nearest-cell selection for ALL stations in one call.
    lat = xr.DataArray([float(s["latitude"]) for s in stations], dims="points")
    lon = xr.DataArray([float(s["longitude"]) for s in stations], dims="points")
    try:
        picked = da.sel(latitude=lat, longitude=lon, method="nearest")
    except Exception as e:  # noqa: BLE001
        print(f"nearest selection failed: {e}", file=sys.stderr)
        return 5

    step_dims = [d for d in picked.dims if d != "points"]
    if step_dims:
        picked = picked.transpose("points", *step_dims)
    arr = np.asarray(picked.values, dtype="float64")
    if arr.ndim == 1:  # single leadtime -> (points,) -> (points, 1)
        arr = arr.reshape(len(stations), 1)

    out: dict[str, list] = {}
    for pi, st in enumerate(stations):
        row = arr[pi]
        series = []
        for si in range(row.shape[0]):
            v = row[si]
            if v != v:  # NaN
                continue
            d = dates[si] if si < len(dates) else ""
            if d:
                series.append({"date": d, "discharge": round(float(v), 2)})
        if series:
            out[str(st["stationId"])] = series

    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
