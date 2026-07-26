#!/usr/bin/env python3
"""Verify guarded source changes cite the required local reference-basis shelf entries."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_POLICY = ROOT / "docs" / "architecture" / "reference-basis-policy.json"


def _run_git(args: list[str], *, repo_root: Path) -> list[str]:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    return [line.strip().replace("\\", "/") for line in completed.stdout.splitlines() if line.strip()]


def _changed_paths(repo_root: Path) -> list[str]:
    paths: set[str] = set()
    paths.update(_run_git(["diff", "--name-only", "HEAD", "--"], repo_root=repo_root))
    paths.update(_run_git(["ls-files", "--others", "--exclude-standard"], repo_root=repo_root))
    return sorted(paths)


def _require_string(payload: dict[str, object], field: str) -> str:
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def _require_string_list(payload: dict[str, object], field: str) -> list[str]:
    value = payload.get(field)
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field} must be a non-empty list")
    result: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field}[{index}] must be a non-empty string")
        result.append(item.strip().replace("\\", "/"))
    return result


def _optional_string_list(value: object, field_name: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list")
    result: list[str] = []
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field_name}[{index}] must be a non-empty string")
        result.append(item.strip().replace("\\", "/"))
    return result


def _parse_iso_date(value: str, field_name: str) -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field_name} must be an ISO date") from exc


def _validate_reference_surfaces(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list) or not value:
        raise ValueError("reference_surfaces must be a non-empty list")

    surfaces: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, surface in enumerate(value):
        if not isinstance(surface, dict):
            raise ValueError(f"reference_surfaces[{index}] must be an object")
        surface_id = _require_string(surface, "surface_id")
        if surface_id in seen:
            raise ValueError(f"duplicate reference surface id: {surface_id}")
        seen.add(surface_id)
        _require_string(surface, "rationale")
        required_ids = _require_string_list(surface, "required_local_reference_ids")

        exact = _optional_string_list(surface.get("path_exact"), f"reference_surfaces[{index}].path_exact")
        prefixes = _optional_string_list(surface.get("path_prefixes"), f"reference_surfaces[{index}].path_prefixes")
        contains = _optional_string_list(surface.get("path_contains"), f"reference_surfaces[{index}].path_contains")
        if not exact and not prefixes and not contains:
            raise ValueError(f"reference_surfaces[{index}] must define at least one path matcher")

        surfaces.append(
            {
                "surface_id": surface_id,
                "rationale": surface["rationale"],
                "required_local_reference_ids": required_ids,
                "path_exact": exact,
                "path_prefixes": prefixes,
                "path_contains": [item.lower() for item in contains],
            }
        )
    return surfaces


def _load_catalog(path: Path) -> set[str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"reference catalog is not readable: {path} ({exc})") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"reference catalog is invalid JSON: {path} ({exc.msg})") from exc

    if not isinstance(payload, dict):
        raise ValueError("reference catalog must be a JSON object")
    entries = payload.get("references")
    if not isinstance(entries, list) or not entries:
        raise ValueError("reference catalog must define a non-empty references list")

    reference_ids: set[str] = set()
    for index, item in enumerate(entries):
        if not isinstance(item, dict):
            raise ValueError(f"references[{index}] must be an object")
        reference_id = item.get("reference_id")
        if not isinstance(reference_id, str) or not reference_id.strip():
            raise ValueError(f"references[{index}].reference_id must be a non-empty string")
        reference_ids.add(reference_id.strip())
    return reference_ids


def _load_policy(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise ValueError(f"reference-basis policy is not readable: {path} ({exc})") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"reference-basis policy is invalid JSON: {path} ({exc.msg})") from exc

    if not isinstance(payload, dict):
        raise ValueError("reference-basis policy must be a JSON object")

    for field in (
        "policy_id",
        "status",
        "reviewed_on",
        "review_expires_at",
        "decision_claim",
        "reference_catalog_path",
        "evidence_directory",
        "rollback_ref",
    ):
        _require_string(payload, field)

    if payload["status"] not in {"observe", "enforced", "waived"}:
        raise ValueError("reference-basis policy status is invalid")

    _parse_iso_date(str(payload["reviewed_on"]), "reviewed_on")
    _parse_iso_date(str(payload["review_expires_at"]), "review_expires_at")
    payload["evidence_excluded_prefixes"] = _optional_string_list(payload.get("evidence_excluded_prefixes"), "evidence_excluded_prefixes")
    payload["required_evidence_tokens"] = _require_string_list(payload, "required_evidence_tokens")
    payload["reference_surfaces"] = _validate_reference_surfaces(payload.get("reference_surfaces"))
    return payload


def _is_evidence_path(path: str, policy: dict[str, object]) -> bool:
    evidence_directory = str(policy["evidence_directory"]).replace("\\", "/")
    excluded = [prefix.replace("\\", "/") for prefix in policy["evidence_excluded_prefixes"]]  # type: ignore[index]
    return (
        path.startswith(evidence_directory)
        and path.endswith(".md")
        and not any(path.startswith(prefix) for prefix in excluded)
    )


def _match_surface(path: str, surface: dict[str, object]) -> bool:
    if path in surface["path_exact"]:  # type: ignore[index]
        return True

    prefixes: list[str] = surface["path_prefixes"]  # type: ignore[assignment]
    contains: list[str] = surface["path_contains"]  # type: ignore[assignment]
    if not prefixes and not contains:
        return False
    prefix_match = True if not prefixes else any(path.startswith(prefix) for prefix in prefixes)
    contains_match = True if not contains else any(token in path.lower() for token in contains)
    return prefix_match and contains_match


def _find_matching_evidence(
    *,
    repo_root: Path,
    evidence_paths: list[str],
    required_tokens: list[str],
    guarded_paths: list[str],
    surface_ids: list[str],
    required_reference_ids: list[str],
) -> tuple[str | None, list[dict[str, object]]]:
    diagnostics: list[dict[str, object]] = []
    for evidence_path in sorted(evidence_paths):
        path = repo_root / evidence_path
        if not path.exists():
            diagnostics.append(
                {
                    "path": evidence_path,
                    "missing_tokens": required_tokens,
                    "missing_guarded_path_mentions": guarded_paths,
                    "missing_surface_ids": surface_ids,
                    "missing_reference_ids": required_reference_ids,
                    "error": "evidence_file_missing",
                }
            )
            continue

        text = path.read_text(encoding="utf-8")
        missing_tokens = [token for token in required_tokens if token not in text]
        missing_guarded_path_mentions = [guarded_path for guarded_path in guarded_paths if guarded_path not in text]
        missing_surface_ids = [surface_id for surface_id in surface_ids if surface_id not in text]
        missing_reference_ids = [reference_id for reference_id in required_reference_ids if reference_id not in text]
        diagnostics.append(
            {
                "path": evidence_path,
                "missing_tokens": missing_tokens,
                "missing_guarded_path_mentions": missing_guarded_path_mentions,
                "missing_surface_ids": missing_surface_ids,
                "missing_reference_ids": missing_reference_ids,
            }
        )
        if not missing_tokens and not missing_guarded_path_mentions and not missing_surface_ids and not missing_reference_ids:
            return evidence_path, diagnostics
    return None, diagnostics


def inspect_reference_basis(
    *,
    repo_root: Path,
    policy_path: Path,
    as_of: dt.date | None = None,
) -> dict[str, object]:
    resolved_root = repo_root.resolve(strict=False)
    policy = _load_policy(policy_path)
    today = as_of or dt.date.today()
    reviewed_on = _parse_iso_date(str(policy["reviewed_on"]), "reviewed_on")
    review_expires_at = _parse_iso_date(str(policy["review_expires_at"]), "review_expires_at")
    if reviewed_on > review_expires_at:
        raise ValueError("reviewed_on must be on or before review_expires_at")

    catalog_path = resolved_root / str(policy["reference_catalog_path"])
    known_reference_ids = _load_catalog(catalog_path)
    for surface in policy["reference_surfaces"]:  # type: ignore[index]
        unknown = sorted(set(surface["required_local_reference_ids"]) - known_reference_ids)  # type: ignore[index]
        if unknown:
            raise ValueError(
                f"reference surface {surface['surface_id']} references unknown local reference ids: {', '.join(unknown)}"
            )

    changed_paths = _changed_paths(resolved_root)
    evidence_candidates = [path for path in changed_paths if _is_evidence_path(path, policy)]

    guarded_details: list[dict[str, object]] = []
    guarded_paths: list[str] = []
    required_reference_ids: list[str] = []
    surface_ids: list[str] = []
    for path in changed_paths:
        if _is_evidence_path(path, policy):
            continue
        matched_surfaces = [
            surface
            for surface in policy["reference_surfaces"]  # type: ignore[index]
            if _match_surface(path, surface)
        ]
        if matched_surfaces:
            ids = sorted(surface["surface_id"] for surface in matched_surfaces)
            refs = sorted({ref for surface in matched_surfaces for ref in surface["required_local_reference_ids"]})
            guarded_paths.append(path)
            guarded_details.append(
                {
                    "path": path,
                    "surface_ids": ids,
                    "required_local_reference_ids": refs,
                }
            )
            surface_ids.extend(ids)
            required_reference_ids.extend(refs)

    unique_surface_ids = sorted(set(surface_ids))
    unique_reference_ids = sorted(set(required_reference_ids))

    payload: dict[str, object] = {
        "status": "pass",
        "policy_path": policy_path.resolve(strict=False).as_posix(),
        "policy_id": policy["policy_id"],
        "reference_catalog_path": catalog_path.resolve(strict=False).as_posix(),
        "reviewed_on": reviewed_on.isoformat(),
        "review_expires_at": review_expires_at.isoformat(),
        "as_of": today.isoformat(),
        "expired": policy["status"] == "enforced" and review_expires_at < today,
        "required_evidence_tokens": policy["required_evidence_tokens"],
        "changed_paths": changed_paths,
        "guarded_paths": guarded_details,
        "evidence_candidates": evidence_candidates,
    }

    if payload["expired"]:
        payload["status"] = "fail"
        payload["reason"] = "reference_basis_policy_expired"
        return payload

    if not guarded_paths:
        payload["reason"] = "no_reference_basis_surfaces_changed"
        return payload

    if not evidence_candidates:
        payload["status"] = "fail"
        payload["reason"] = "missing_reference_basis_evidence"
        return payload

    matched_evidence, diagnostics = _find_matching_evidence(
        repo_root=resolved_root,
        evidence_paths=evidence_candidates,
        required_tokens=list(policy["required_evidence_tokens"]),  # type: ignore[arg-type]
        guarded_paths=guarded_paths,
        surface_ids=unique_surface_ids,
        required_reference_ids=unique_reference_ids,
    )
    payload["evidence_diagnostics"] = diagnostics
    if matched_evidence is None:
        payload["status"] = "fail"
        payload["reason"] = "reference_basis_evidence_incomplete"
        return payload

    payload["matched_evidence"] = matched_evidence
    payload["reason"] = "matching_reference_basis_evidence"
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=str(ROOT))
    parser.add_argument("--policy", default=str(DEFAULT_POLICY))
    parser.add_argument("--as-of", default=None, help="ISO date used for policy expiry checks; defaults to today.")
    args = parser.parse_args(argv)

    try:
        as_of = dt.date.fromisoformat(args.as_of) if args.as_of else dt.date.today()
    except ValueError:
        print(json.dumps({"status": "error", "reason": f"invalid --as-of date: {args.as_of}"}, ensure_ascii=False, indent=2))
        return 2

    try:
        payload = inspect_reference_basis(
            repo_root=Path(args.repo_root),
            policy_path=Path(args.policy),
            as_of=as_of,
        )
    except Exception as exc:
        print(json.dumps({"status": "error", "reason": str(exc)}, ensure_ascii=False, indent=2))
        return 2

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
