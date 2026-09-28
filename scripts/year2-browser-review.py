"""Run the source-built app in Chromium with isolated, synthetic calendar data.

Requires a running production preview and Python Playwright (outside npm).
YEAR2_URL defaults to http://127.0.0.1:4173; YEAR2_REVIEW_DIR to review/year2.
No remote account, live integration, or user data is used.
"""
import json
import os
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

URL = os.environ.get("YEAR2_URL", "http://127.0.0.1:4173")
OUT = Path(os.environ.get("YEAR2_REVIEW_DIR", "review/year2"))
OUT.mkdir(parents=True, exist_ok=True)


def fixture(language="zh-CN", dark=False):
    names = (["项目复核", "阅读与笔记", "家庭活动", "方案沟通", "阶段总结", "学习演讲"]
             if language == "zh-CN" else
             ["Project review", "Reading notes", "Family time", "Design meeting", "Milestone review", "Presentation practice"])
    colors = ["bg-blue-500", "bg-purple-500", "bg-teal-500", "bg-orange-500", "bg-emerald-500", "bg-rose-500"]
    tasks = []
    for month in range(1, 13):
        for index, day in enumerate([3, 8, 12, 16, 21, 25]):
            tasks.append({
                "id": f"year2-demo-{month}-{day}", "title": names[index],
                "date": f"2026-{month:02}-{day:02}", "startTime": "09:00",
                "duration": 60, "color": colors[index], "completed": False,
                "notes": "", "subtasks": [], "lastModified": "2026-09-20T01:00:00.000Z",
                "createdAt": "2026-01-01T00:00:00.000Z",
            })
    tasks.extend([
        dict(tasks[-1], id="year2-detail-1", date="2026-09-16", title="排水方案复核", startTime="10:00"),
        dict(tasks[-1], id="year2-detail-2", date="2026-09-16", title="整理设计意见", startTime="14:00"),
    ])
    storage = {
        "day-planner-tasks": json.dumps(tasks, ensure_ascii=False),
        "day-planner-unscheduled": "[]", "day-planner-default-view": '"year2"',
        "day-planner-view-mode": "year2", "day-planner-week-start-day": "1",
        "day-planner-use-24h-clock": "true", "day-planner-darkmode": json.dumps(dark),
        "day-planner-weather-enabled": "false", "day-planner-daily-content-enabled": "false",
        "day-planner-sound-enabled": "false", "day-planner-routines-enabled": "false",
        "day-planner-habits-enabled": "false", "gettingStartedDismissed": "true",
        "storageWarnDismissed": "1", "i18nextLng": language,
        "day-planner-daily-notes": json.dumps({"2026-09-16": {
            "text": "记录本周重点与收获。", "lastModified": "2026-09-16T13:00:00Z"}}),
    }
    return storage


def loaded(page, date="2026-09-16"):
    page.goto(f"{URL}/?view=year2&date={date}", wait_until="networkidle", timeout=60000)
    expect(page.locator("[data-year2-view]")).to_be_visible(timeout=30000)
    expect(page.locator("[data-year2-month]")).to_have_count(12)
    page.wait_for_timeout(500)


def calendar_snapshot(page):
    return page.evaluate("""() => JSON.parse(localStorage.getItem('day-planner-tasks') || '[]')
      .filter(t => String(t.id).startsWith('year2-'))
      .map(({ id, title, date, startTime, duration, completed }) => ({ id, title, date, startTime, duration, completed }))""")


def main():
    checks = []
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1920, "height": 1080},
                                      device_scale_factor=1, locale="zh-CN", timezone_id="Asia/Singapore")
        context.add_init_script("for (const [k,v] of Object.entries(" + json.dumps(fixture()) + ")) localStorage.setItem(k,v);")
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        try:
            loaded(page)
            expect(page.locator("[data-year2-date]")).to_have_count(365)
            expect(page.locator('[data-year2-date="2026-01-03"]')).to_contain_text("项目复核")
            expect(page.locator('[data-year2-date="2026-12-25"]')).to_contain_text("学习演讲")
            checks.append("365 unique dates, twelve months, native January and December tasks visible")
            before = calendar_snapshot(page)
            page.screenshot(path=str(OUT / "year2-light.png"))
            page.set_viewport_size({"width": 1920, "height": 1900})
            page.screenshot(path=str(OUT / "year2-full-year.png"))
            page.set_viewport_size({"width": 1920, "height": 1080})

            selected = page.locator('[data-year2-date="2026-09-16"]')
            expect(selected.locator('.year2-more')).to_have_text("+1")
            selected.click()
            sheet = page.locator('[data-month-day-sheet="2026-09-16"]')
            expect(sheet).to_be_visible()
            expect(sheet).to_contain_text("排水方案复核")
            expect(sheet).to_contain_text("整理设计意见")
            page.wait_for_timeout(300)
            page.screenshot(path=str(OUT / "year2-day-agenda.png"))
            page.keyboard.press("Escape")
            expect(page.locator('[data-month-day-sheet]')).to_have_count(0)
            checks.append("Date opens native agenda, overflow entries accessible, Escape dismisses")

            selected.focus()
            page.keyboard.press("ArrowRight")
            expect(page.locator('[data-year2-date="2026-09-17"]')).to_be_focused()
            expect(page.locator('[data-year2-date="2026-09-17"]')).to_have_attribute("aria-pressed", "true")
            page.keyboard.press("PageDown")
            expect(page.locator('[data-year2-date="2026-10-17"]')).to_be_focused()
            checks.append("Roving date keyboard navigation does not trigger global year navigation")

            # Press a global key from the document, not from a focused date cell.
            page.locator('[data-year2-view]').evaluate("el => { document.activeElement.blur(); }")
            page.keyboard.press("ArrowRight")
            expect(page.locator('[data-year2-date="2027-10-17"]')).to_have_attribute("aria-pressed", "true")
            page.keyboard.press("ArrowLeft")
            expect(page.locator('[data-year2-date="2026-10-17"]')).to_have_attribute("aria-pressed", "true")
            checks.append("Global left/right arrows navigate a year and preserve month/day")

            page.locator('[data-year2-month="9"] h2 button').click()
            expect(page.locator('[data-month-view]')).to_be_visible()
            page.keyboard.press("8")
            expect(page.locator('[data-year2-view]')).to_be_visible()
            page.keyboard.press("7")
            expect(page.locator('.jobu-year')).to_be_visible()
            expect(page.locator('[data-year2-view]')).to_have_count(0)
            page.keyboard.press("8")
            expect(page.locator('[data-year2-view]')).to_be_visible()
            checks.append("Month drill-down, Year 2 shortcut 8, original Year shortcut 7 coexist")

            for width in [1180, 850]:
                page.set_viewport_size({"width": width, "height": 1000})
                expect(page.locator('[data-year2-view]')).to_be_visible()
                page.wait_for_timeout(250)
                size = page.locator('[data-year2-view]').evaluate("el => ({ width: el.clientWidth, scroll: el.scrollWidth })")
                assert size["scroll"] <= size["width"] + 2, size
                page.screenshot(path=str(OUT / f"year2-{width}px.png"))
                checks.append(f"Responsive {width}px window has no Year 2 horizontal overflow")
            assert calendar_snapshot(page) == before, "Read-only navigation changed native task content"
            checks.append("Navigation did not change task identities, titles, schedules or completion")

            page.set_viewport_size({"width": 1920, "height": 1080})
            page.locator('[data-year2-view]').evaluate("el => { document.activeElement.blur(); }")
            page.keyboard.press("d")
            expect(page.locator('[data-year2-view]')).to_have_class(__import__('re').compile("year2-dark"))
            page.locator('[data-year2-view]').evaluate("el => el.scrollTop = 0")
            page.screenshot(path=str(OUT / "year2-dark.png"))
            checks.append("Dark theme follows the native app theme")

            # A separate browser session checks English and leap-day navigation.
            english = browser.new_context(viewport={"width": 1680, "height": 1080}, locale="en-US", timezone_id="America/Chicago")
            english.add_init_script("for (const [k,v] of Object.entries(" + json.dumps(fixture("en")) + ")) localStorage.setItem(k,v);")
            en_page = english.new_page()
            en_page.on("pageerror", lambda error: errors.append(str(error)))
            loaded(en_page, "2028-02-29")
            expect(en_page.locator('[data-year2-date]')).to_have_count(366)
            expect(en_page.locator('[data-year2-view]')).to_have_attribute("aria-label", "Year 2")
            en_page.keyboard.press("ArrowRight")
            expect(en_page.locator('[data-year2-date="2029-02-28"]')).to_have_attribute("aria-pressed", "true")
            en_page.screenshot(path=str(OUT / "year2-english.png"))
            english.close()
            checks.append("English localization and Feb 29 to Feb 28 year navigation in Chicago")
            assert not errors, errors
            checks.append("No uncaught browser page errors")
        except Exception:
            page.screenshot(path=str(OUT / "failure.png"))
            (OUT / "failure-body.txt").write_text(page.locator('body').inner_text(), encoding="utf-8")
            raise
        finally:
            (OUT / "browser-results.json").write_text(json.dumps({"checks": checks, "pageErrors": errors}, ensure_ascii=False, indent=2), encoding="utf-8")
            browser.close()
    print(json.dumps({"passed": len(checks), "checks": checks}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
