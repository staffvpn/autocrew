"""Подбор стоимости ступеней и порогов репутации/заказов под целевые сроки.

Для каждой ступени: сначала находит, сколько репутации и заказов набирает активный
игрок к целевому дню, ставит порог 85% от этого, затем подбирает стоимость перехода
так, чтобы деньги набирались ровно к целевому дню. Итог переносится вручную
(с округлением) в STAGES в balance_sim.py.
"""
import random, balance_sim as b

TARGET_DAY = {1: 3, 2: 8, 3: 22, 4: 50, 5: 80, 6: 130, 7: 210, 8: 320}
S = b.STAGES

def tune_cost(st):
    lo, hi = 1e3, 3e9
    for _ in range(50):
        mid = (lo * hi) ** 0.5; S[st]['cost'] = mid
        r = b.run(1.0)[0]
        lo, hi = (mid, hi) if st in r and r[st] <= TARGET_DAY[st] else (lo, mid)
    S[st]['cost'] = lo

def progress_at(day_stop, reached):
    rnd = random.Random(7); rep, done, st = 0.0, 0, 0
    for day in range(1, day_stop + 1):
        s = S[st]
        demand = max(0, rnd.gauss(min(s['cap'], s['demand0'] + rep * s['demand_k']), 0.15 * min(s['cap'], s['demand0'] + rep * s['demand_k'])))
        rnd.random()
        cap = (b.OWNER_NH if st < 5 else 0) + s['staff'] * b.STAFF_NH * b.STAFF_EFF
        n = min(demand, cap / s['nh']) if s['nh'] else 0; fails = n * b.QUALITY_FAIL
        rep = max(0, min(b.REP_MAX, rep + ((n - fails) * b.REP_GOOD + fails * b.REP_BAD) * 60 / (60 + rep))); done += n
        if reached.get(st + 1) == day: st += 1
    return rep, done

for st in range(1, len(S)):
    S[st]['need_rep'] = S[st]['need_orders'] = 0
    for k in range(st + 1, len(S)): S[k]['cost'] = 1e12
    tune_cost(st)
    rep, done = progress_at(TARGET_DAY[st], b.run(1.0)[0])
    S[st]['need_rep'], S[st]['need_orders'] = round(rep * 0.85), round(done * 0.85)
    tune_cost(st)
    print(f"{st}. {S[st]['name']:<24} cost={S[st]['cost']:>14,.0f}  need_rep={S[st]['need_rep']:>4}  need_orders={S[st]['need_orders']:>6}")
