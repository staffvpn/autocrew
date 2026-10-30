"""AUTO CREW — модель баланса прогрессии (черновик для согласования).

Симулирует «типичного активного игрока» по дням: спрос на заказы, выручку,
постоянные расходы и переходы между ступенями бизнеса. Цель — проверить,
что сроки прохождения ступеней совпадают с целевыми, а не подогнаны вручную.

Запуск: python3 tools/balance_sim.py [--casual]
"""
import random, sys

# Ступени бизнеса. Все суммы в ₽, время в норма-часах (н/ч).
# cost — разовые вложения при переходе (оборудование + депозит аренды + ремонт помещения)
# fixed — постоянные расходы в сутки: аренда + коммуналка + обслуживание оборудования
# rate — ставка норма-часа; nh/parts — средний заказ; margin — наценка на запчасти
# staff — механики (кроме владельца); salary — зарплата механика в сутки
# admin — прочий персонал в сутки (приёмщик, закупщик, бухгалтер)
# demand0/demand_k/cap — спрос: заказов в сутки = min(cap, demand0 + репутация*demand_k)
# need_rep/need_orders — условия открытия ступени (помимо денег)
STAGES = [
    dict(name='Пустой гараж',            cost=0,          fixed=850,     rate=1200,  nh=0.6, parts=2500,  margin=0.05, staff=0,  salary=0,    admin=0,      demand0=3,  demand_k=0.050, cap=9,   need_rep=0,   need_orders=0),
    dict(name='Оборудованный гараж',     cost=30_000,     fixed=1_000,   rate=1500, nh=0.8, parts=3500,  margin=0.10, staff=0,  salary=0,    admin=0,      demand0=4,  demand_k=0.050, cap=10,  need_rep=15,  need_orders=8),
    dict(name='Первый механик',          cost=15_000,     fixed=1_300,   rate=1500, nh=0.8, parts=3800,  margin=0.12, staff=1,  salary=2500, admin=0,      demand0=5,  demand_k=0.050, cap=14,  need_rep=45,  need_orders=30),
    dict(name='Мастерская на 3 поста',   cost=120_000,    fixed=3_800,   rate=1900, nh=1.1, parts=5500,  margin=0.15, staff=2,  salary=2800, admin=0,      demand0=7,  demand_k=0.045, cap=20,  need_rep=125, need_orders=140),
    dict(name='Автосервис (5 постов)',   cost=650_000,  fixed=9_000,   rate=2300, nh=1.5, parts=8500,  margin=0.20, staff=5,  salary=3200, admin=2500,   demand0=9,  demand_k=0.040, cap=30,  need_rep=260, need_orders=490),
    dict(name='Перепродажа авто',        cost=2_000_000,  fixed=13_000,  rate=2500, nh=1.6, parts=9500,  margin=0.22, staff=7,  salary=3400, admin=6000,   demand0=10, demand_k=0.040, cap=38,  need_rep=400, need_orders=1050, flips=2),
    dict(name='Несколько направлений',   cost=5_000_000, fixed=32_000,  rate=2900, nh=1.9, parts=13000, margin=0.25, staff=14, salary=3800, admin=16000,  demand0=14, demand_k=0.040, cap=60,  need_rep=600, need_orders=2150, flips=4, extra=90_000),
    dict(name='Автомобильный холдинг',   cost=26_000_000, fixed=95_000,  rate=3300, nh=2.2, parts=18000, margin=0.28, staff=32, salary=4300, admin=55000,  demand0=30, demand_k=0.045, cap=140, need_rep=820, need_orders=5000, flips=10, extra=420_000),
    dict(name='AUTO CREW PRIME',         cost=110_000_000,fixed=0,       rate=0,    nh=0,   parts=0,     margin=0,    staff=0,  salary=0,    admin=0,      demand0=0,  demand_k=0,     cap=0,   need_rep=850, need_orders=12000),
]
OWNER_NH = 5.0        # сколько н/ч владелец реально отрабатывает сам за активный день (≈20–25 мин игры)
STAFF_NH = 7.0        # н/ч механика за смену с учётом усталости и простоев
STAFF_EFF = 0.85      # средняя эффективность нанятого механика
OFFLINE_SHARE = 0.6   # доля смены, которую персонал отрабатывает без владельца (офлайн-окно 8 ч из ~13)
CONSUMABLES = 0.04    # расходники (ветошь, очистители) — доля от работ
TAX = 0.06            # упрощённый налог с выручки
QUALITY_FAIL = 0.06   # доля заказов с претензией (переделка за свой счёт, -репутация)
REP_GOOD, REP_BAD, REP_MAX = 2.5, -8, 1000
RESERVE_DAYS = 7      # игрок не переходит на ступень, если после неё не останется денег на неделю расходов
# перепродажа авто: оборот одной машины ~6 дней, средняя прибыль после рисков (скрытые дефекты, торг)
FLIP_CAPITAL, FLIP_PROFIT, FLIP_DAYS, FLIP_LOSS_P, FLIP_LOSS = 600_000, 70_000, 6, 0.18, -90_000

def run(owner_active_share=1.0, seed=7, days=900):
    rnd = random.Random(seed)
    # 60 000 ₽ стартового капитала, из них ~28 000 ₽ уходит на обязательный стартовый набор инструментов
    cash, rep, orders_done, st = 60_000 - 28_000, 0.0, 0, 0
    reached, limits, first_ok = {0: 0}, {}, {}
    for day in range(1, days + 1):
        s = STAGES[st]
        active = rnd.random() < owner_active_share
        demand = min(s['cap'], s['demand0'] + rep * s['demand_k'])
        demand = max(0, rnd.gauss(demand, demand * 0.15))
        # без управляющего (до ступени 5) в отсутствие владельца механики берут заказы только в офлайн-окне
        staff_share = 1.0 if active or st >= 5 else OFFLINE_SHARE
        cap_nh = (OWNER_NH if active and st < 5 else 0) + s['staff'] * STAFF_NH * STAFF_EFF * staff_share
        n = min(demand, cap_nh / s['nh']) if s['nh'] else 0
        labor = n * s['nh'] * s['rate']
        parts_margin = n * s['parts'] * s['margin']
        fails = n * QUALITY_FAIL
        income = labor + parts_margin - fails * s['nh'] * s['rate']
        costs = s['fixed'] + s['staff'] * s['salary'] + s['admin'] + labor * CONSUMABLES + income * TAX
        if s.get('flips'):
            per_day = s['flips'] * (FLIP_PROFIT * (1 - FLIP_LOSS_P) + FLIP_LOSS * FLIP_LOSS_P) / FLIP_DAYS
            income += per_day if (active or st >= 5) else per_day * 0.3
        income += s.get('extra', 0)
        cash += income - costs
        rep = min(REP_MAX, rep + ((n - fails) * REP_GOOD + fails * REP_BAD) * 60 / (60 + rep))
        rep = max(0, rep)
        orders_done += n
        nxt = STAGES[st + 1] if st + 1 < len(STAGES) else None
        if nxt:
            reserve = RESERVE_DAYS * (nxt['fixed'] + nxt['staff'] * nxt['salary'] + nxt['admin'])
            ok = dict(деньги=cash >= nxt['cost'] + reserve, репутация=rep >= nxt['need_rep'], заказы=orders_done >= nxt['need_orders'])
            for k, v in ok.items():
                if v: first_ok.setdefault((st + 1, k), day)
            if all(ok.values()):
                cash -= nxt['cost']; st += 1; reached[st] = day
                limits[st] = max(ok, key=lambda k: first_ok[(st, k)])
        if cash < -50_000:
            return reached, limits, day, 'банкротство'
        if st == len(STAGES) - 1:
            break
    return reached, limits, day, None

if __name__ == '__main__':
    share = 0.55 if '--casual' in sys.argv else 1.0
    reached, limits, day, fail = run(share)
    print(f"Профиль: {'казуальный (заходит ~4 дня из 7)' if share < 1 else 'активный (каждый день)'}")
    for i, s in enumerate(STAGES):
        print(f"  {i}. {s['name']:<24} {('день ' + str(reached[i])) if i in reached else '—':<10} {('сдерживает: ' + limits[i]) if i in limits else ''}")
    if fail: print('  !', fail, 'на дне', day)
