# Вебхуки

Вебхуки для уведомления о событиях в системе.

**Настройка:**

1. Перейдите в Дэшборд автора → Настройки (меню три точки) → Раздел API-ключи
2. Сгенерируйте API-ключ, если ещё не сделали это
3. Укажите URL вашего вебхука в настройках вебхуков

**Проверка подписи:** Каждый запрос содержит заголовок `trbt-signature` с HMAC-SHA256 подписью тела запроса, подписанного вашим API-ключом.

**Повторные попытки:** При ошибке доставки система повторяет попытки через 5мин, 15мин, 30мин, 1ч, 10ч.

{% openapi-webhook spec="api-ru" name="newSubscription" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="cancelledSubscription" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="physicalOrderCreated" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="physicalOrderShipped" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="physicalOrderCanceled" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="newDonation" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="recurrentDonation" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="cancelledDonation" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}

{% openapi-webhook spec="api-ru" name="newDigitalProduct" method="post" %}
[Broken link](https://wiki.tribute.tg/ru/api-dokumentaciya/broken-reference)
{% endopenapi-webhook %}
