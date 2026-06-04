📑 Технический паспорт бэкенда: Truck Park
1. Стек и инфраструктура
Backend: Supabase (PostgreSQL 15+)
Расширения: PostGIS (гео-данные), pg_trgm (быстрый поиск).
Хранилище: Supabase Storage (Бакет: parking_content).
Маршрутизация: Firebase Hosting (Deep Links через deeplink.html).
2. Ключевая бизнес-логика (SQL RPC)
2.1. Универсальный поиск и кластеризация
Функция: get_filtered_parkings (v5.9)
Назначение: Возвращает объекты для карты или списка. Выполняет серверную кластеризацию по сетке.
Порог развала кластеров: Зум 10.0 (установлено в grid_size).
Логика поиска: Если передан search_query, ищет по полю address_lower глобально.
Гео-фильтр: Если radius_meters > 0, ищет в круге. Если 0, ищет в границах экрана (min_lat / max_lat).
<details>
<summary>Посмотреть SQL код</summary>
code
SQL
CREATE OR REPLACE FUNCTION get_filtered_parkings(
  center_lat FLOAT8, center_lng FLOAT8, radius_meters FLOAT8,
  min_lat FLOAT8, max_lat FLOAT8, min_lng FLOAT8, max_lng FLOAT8,
  min_capacity INT4, max_capacity INT4,
  need_gas BOOLEAN, need_shower BOOLEAN, need_laundry BOOLEAN,
  need_hotel BOOLEAN, need_shop BOOLEAN, need_recreation BOOLEAN,
  is_filter_active BOOLEAN, zoom_level FLOAT8,
  search_query TEXT DEFAULT NULL
)
RETURNS SETOF JSON LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  grid_size FLOAT8;
  has_search BOOLEAN;
BEGIN
  has_search := (search_query IS NOT NULL AND search_query <> '');
  grid_size := CASE 
    WHEN zoom_level < 4 THEN 10.0
    WHEN zoom_level < 6 THEN 5.0
    WHEN zoom_level < 8 THEN 1.5
    WHEN zoom_level < 10.0 THEN 0.1 
    ELSE 0 
  END;
  RETURN QUERY WITH raw_data AS (
    SELECT * FROM public.parkings
    WHERE (NOT has_search OR address_lower LIKE '%' || LOWER(search_query) || '%')
      AND (CASE 
          WHEN has_search AND NOT (is_filter_active AND radius_meters > 0) THEN TRUE
          WHEN (is_filter_active AND radius_meters > 0) THEN 
            (6371000 * acos(LEAST(GREATEST(cos(radians(center_lat)) * cos(radians(latitude)) * cos(radians(longitude) - radians(center_lng)) + sin(radians(center_lat)) * sin(radians(latitude)), -1.0), 1.0))) <= radius_meters
          ELSE (latitude >= min_lat AND latitude <= max_lat AND longitude >= min_lng AND longitude <= max_lng)
        END)
      AND (CASE WHEN is_filter_active THEN (
            (COALESCE(total_spaces, 0) >= COALESCE(min_capacity, 0) AND COALESCE(total_spaces, 0) <= COALESCE(max_capacity, 10000))
            AND (need_gas IS NOT TRUE OR has_gas_station IS TRUE)
            AND (need_shower IS NOT TRUE OR has_shower IS TRUE)
            AND (need_laundry IS NOT TRUE OR has_laundry IS TRUE)
            AND (need_hotel IS NOT TRUE OR has_hotel IS TRUE)
            AND (need_shop IS NOT TRUE OR has_shop IS TRUE)
            AND (need_recreation IS NOT TRUE OR has_recreation_area IS TRUE))
          ELSE TRUE END)
  ), grouping AS (
    SELECT CASE WHEN grid_size > 0 THEN floor(latitude / grid_size)::text || '_' || floor(longitude / grid_size)::text ELSE id::text END as bucket_id,
      AVG(latitude) as lat, AVG(longitude) as lng, COUNT(*)::INT as points_count,
      MAX(id::text) as single_id, MAX(address) as single_address, MAX(rating) as single_rating
    FROM raw_data GROUP BY bucket_id
  )
  SELECT row_to_json(out) FROM (
    SELECT CASE WHEN points_count > 1 THEN 'c_' || bucket_id ELSE single_id END as id,
      lat, lng, lat as latitude, lng as longitude, points_count as count, (grid_size > 0) as is_cluster,
      CASE WHEN points_count = 1 THEN single_address ELSE NULL END as address,
      CASE WHEN points_count = 1 THEN single_rating ELSE NULL END as rating
    FROM grouping
  ) out;
END; $$;
</details>
3. Автоматизация рейтингов (Triggers)
3.1. Пересчет рейтинга парковки
Триггер: tr_update_parking_stats на таблицу reviews.
Логика: При любом изменении отзыва (добавление, правка, удаление) пересчитывает средний балл парковки, общее кол-во отзывов и распределение по звездам (stars_1...5).
<details>
<summary>Посмотреть SQL код</summary>
code
SQL
CREATE OR REPLACE FUNCTION public.handle_full_rating_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    target_id UUID;
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        NEW.average_score := (NEW.rating_impression + NEW.rating_arrival + NEW.rating_security + NEW.rating_infrastructure + NEW.rating_comfort) / 5.0;
        target_id := NEW.parking_id;
    ELSIF (TG_OP = 'DELETE') THEN
        target_id := OLD.parking_id;
    END IF;

    UPDATE public.parkings SET 
        rating = ROUND(CAST(COALESCE((SELECT AVG(average_score) FROM public.reviews WHERE parking_id = target_id), 4.0) AS NUMERIC), 1),
        reviews_count = (SELECT COUNT(*) FROM public.reviews WHERE parking_id = target_id),
        stars_1 = (SELECT COUNT(*) FROM public.reviews WHERE parking_id = target_id AND ROUND(average_score) = 1),
        stars_2 = (SELECT COUNT(*) FROM public.reviews WHERE parking_id = target_id AND ROUND(average_score) = 2),
        stars_3 = (SELECT COUNT(*) FROM public.reviews WHERE parking_id = target_id AND ROUND(average_score) = 3),
        stars_4 = (SELECT COUNT(*) FROM public.reviews WHERE parking_id = target_id AND ROUND(average_score) = 4),
        stars_5 = (SELECT COUNT(*) FROM public.reviews WHERE parking_id = target_id AND ROUND(average_score) = 5)
    WHERE id = target_id;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$;
</details>
4. Безопасность и Роли (RLS)
4.1. Система ролей (Admin)
Колонка is_admin (boolean) в таблице users.
Функция public.is_admin() проверяет статус текущего auth.uid().
4.2. Политики доступа
Parkings: Просмотр — всем; Удаление — только is_admin(); Обновление — админ или создатель.
Users: Регистрация через триггер handle_new_auth_user. Поле status имеет тип ENUM (pending, approved, rejected).
Reports: Админ видит все жалобы, пользователь — только свои.
5. Важные пути Storage и Навигации
Фото парковок: parking_content/parkings/{parking_id}/{index}.jpg
Фото отзывов: parking_content/parkings/{parking_id}/reviews/{review_id}/{index}.jpg
Deep Link (Android/iOS): https://js-truck-park.web.app/deeplink.html?route=...
6. Оптимизация поиска
Для мгновенного поиска по адресу используется триграммный индекс:
code
SQL
CREATE INDEX idx_parkings_address_trgm ON public.parkings USING gin (address_lower gin_trgm_ops);