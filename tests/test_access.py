from funroads.access import allowed_windows, WINDOWS
from funroads.graph import is_drivable_way


def test_sunday_closed_road_is_available_on_weekdays_only():
    road = {"highway": "unclassified", "surface": "asphalt"}
    assert is_drivable_way(road)
    tags = {**road, "motor_vehicle:conditional": "no @ (Sa,Su, Jul, Aug, PH)"}
    assert is_drivable_way(tags)
    mask = allowed_windows(tags)
    assert [label for i, (label, _) in enumerate(WINDOWS) if mask & (1 << i)] == [
        "2026-09-28 08:00", "2026-09-28 20:00"
    ]
    assert allowed_windows({**road, "access:conditional": "no @ (Su 08:00-18:00)"}) & (1 << 6) == 0
    assert not is_drivable_way({**road, "motorcar": "no"})
    assert not is_drivable_way({**road, "vehicle": "no"})
    solar = {**road, "motor_vehicle:conditional": "no @ (sunset-sunrise)"}
    assert allowed_windows(solar) & (1 << 4)
    assert not allowed_windows(solar) & (1 << 5)
    assert allowed_windows({**road, "motor_vehicle:conditional": "no @ permit_holder"}) == 0
    seasonal = {**road, "motor_vehicle:conditional":
                "no @ (Nov 1-Mar 16 17:00-09:00; Mar 16-Oct 31 21:00-09:00)"}
    assert allowed_windows(seasonal) & (1 << 4) == 0  # closes before morning drive ends
    assert allowed_windows(seasonal) & (1 << 5) == 0
    rush = {**road, "motor_vehicle:conditional":
            "no @ (Mo-Fr 07:00-10:00,16:00-19:00)"}
    assert not allowed_windows(rush) & (1 << 4)
    assert allowed_windows(rush) & (1 << 5)
