"""
Test de charge ScolarHub v2 (Python, aucune installation requise)

Usage :
    python stress-test-v2.py

Pour tester des routes authentifiees (optionnel), definis un token d'un compte de test :
    Windows (cmd) :  set TOKEN=ton_jwt && python stress-test-v2.py
"""

import urllib.request
import urllib.error
import json
import os
import random
import threading
import time
from urllib.parse import urljoin

BACKEND_URL = "https://backend-scolarhub.onrender.com"
TOKEN = os.environ.get("TOKEN")  # optionnel

ENDPOINTS = [
    {"method": "GET",  "path": "/api/annonces",   "data": None},
    {"method": "GET",  "path": "/api/auth/me",    "data": None},
    {"method": "POST", "path": "/api/auth/lookup",
     "data": json.dumps({"matricule": "TEST-0001"}).encode("utf-8")},
]

# Chaque phase : N utilisateurs virtuels qui envoient des requetes en boucle pendant `duration` secondes
PHASES = [
    {"name": "Legere",   "users": 10,  "duration": 20},
    {"name": "Normale",  "users": 50,  "duration": 20},
    {"name": "Elevee",   "users": 100, "duration": 20},
    {"name": "Stress 1", "users": 200, "duration": 20},
    {"name": "Stress 2", "users": 300, "duration": 20},
    {"name": "Stress 3", "users": 500, "duration": 20},
]

THINK_TIME = (0.1, 0.5)   # pause aleatoire entre 2 requetes d'un meme utilisateur (secondes)
TIMEOUT = 15
MAX_ERROR_RATE = 5.0      # % d'erreurs tolere
MAX_P95_MS = 3000         # p95 tolere


def one_request(ep):
    url = urljoin(BACKEND_URL, ep["path"])
    req = urllib.request.Request(url, data=ep["data"], method=ep["method"])
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "ScolarHub-StressTest/2.0")
    if TOKEN:
        req.add_header("Authorization", f"Bearer {TOKEN}")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            status = r.status
            r.read()
    except urllib.error.HTTPError as e:
        status = e.code
    except Exception as e:
        status = type(e).__name__  # TimeoutError, URLError, ...
    return status, int((time.time() - t0) * 1000)


def is_server_error(status):
    # Erreur = 5xx, timeout, erreur reseau. Les 4xx sont comptes a part.
    return not isinstance(status, int) or status >= 500


def run_phase(phase):
    print("\n" + "=" * 64)
    print(f"Phase {phase['name']} : {phase['users']} utilisateurs simultanes pendant {phase['duration']}s")
    print("=" * 64)

    lock = threading.Lock()
    times, codes = [], {}
    stop_at = time.time() + phase["duration"]

    def user_loop():
        while time.time() < stop_at:
            status, ms = one_request(random.choice(ENDPOINTS))
            with lock:
                times.append(ms)
                codes[status] = codes.get(status, 0) + 1
            time.sleep(random.uniform(*THINK_TIME))

    t_start = time.time()
    threads = [threading.Thread(target=user_loop) for _ in range(phase["users"])]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    dur = time.time() - t_start

    times.sort()
    n = len(times)
    avg = sum(times) / n if n else 0
    p50 = times[int(n * 0.50)] if n else 0
    p95 = times[min(int(n * 0.95), n - 1)] if n else 0
    p99 = times[min(int(n * 0.99), n - 1)] if n else 0
    errors = sum(c for s, c in codes.items() if is_server_error(s))
    ok_2xx = sum(c for s, c in codes.items() if isinstance(s, int) and 200 <= s < 300)
    err_rate = round(errors / n * 100, 1) if n else 100.0
    rps = round(n / dur, 1)

    print(f"  Requetes : {n} | 2xx : {ok_2xx} | Erreurs serveur/reseau : {errors} ({err_rate}%)")
    print(f"  Debit : {rps} req/s")
    print(f"  Latence : moy {int(avg)} ms | p50 {p50} ms | p95 {p95} ms | p99 {p99} ms | max {times[-1] if n else 0} ms")
    print(f"  Codes de reponse : {dict(sorted(codes.items(), key=lambda x: str(x[0])))}")

    return {"name": phase["name"], "users": phase["users"], "rps": rps, "avg": int(avg),
            "p95": p95, "err_rate": err_rate, "codes": codes}


def main():
    print("=" * 64)
    print("  TEST DE CHARGE SCOLARHUB v2")
    print(f"  Cible : {BACKEND_URL}")
    print(f"  Authentification : {'oui (token)' if TOKEN else 'non'}")
    print("=" * 64)

    print("\nReveil du serveur (cold start possible)...")
    for _ in range(3):
        one_request(ENDPOINTS[0])
        time.sleep(1)

    summary = []
    for ph in PHASES:
        summary.append(run_phase(ph))
        time.sleep(3)  # laisse le serveur souffler

    print("\n" + "=" * 64)
    print("                     RAPPORT FINAL")
    print("=" * 64)
    print(f"{'Phase':<10} | {'Users':<6} | {'Req/s':<7} | {'Moy ms':<7} | {'p95 ms':<7} | Erreurs")
    print("-" * 60)
    for s in summary:
        print(f"{s['name']:<10} | {s['users']:<6} | {s['rps']:<7} | {s['avg']:<7} | {s['p95']:<7} | {s['err_rate']}%")
    print("-" * 60)

    good = None
    for s in summary:
        if s["err_rate"] <= MAX_ERROR_RATE and s["p95"] <= MAX_P95_MS:
            good = s
        else:
            break

    print("\nCONCLUSION :")
    if good is None:
        print(f"  -> Des la premiere phase, les seuils (erreurs <= {MAX_ERROR_RATE}%, p95 <= {MAX_P95_MS} ms) sont depasses.")
    elif good is summary[-1]:
        print(f"  -> Seuils respectes jusqu'a {good['users']} utilisateurs simultanes (derniere phase testee).")
        print("  -> La limite du serveur n'a PAS ete atteinte : augmente les phases pour la trouver.")
    else:
        print(f"  -> Seuils respectes jusqu'a {good['users']} utilisateurs simultanes ({good['rps']} req/s, moy {good['avg']} ms).")
        print("  -> Au-dela, la latence ou le taux d'erreur depasse les seuils : c'est ta limite estimee.")
    print("\nNote : lance aussi Render > Metrics et Supabase > Reports pendant le test.")
    print("=" * 64)


if __name__ == "__main__":
    main()