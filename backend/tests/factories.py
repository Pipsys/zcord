from __future__ import annotations

import factory

from app.models.user import User, UserStatus
from app.utils.password import hash_password


class UserFactory(factory.Factory):
    class Meta:
        model = User

    username = factory.Sequence(lambda n: f"user{n}")
    discriminator = factory.Sequence(lambda n: f"{n % 10000:04d}")
    email = factory.Sequence(lambda n: f"user{n}@example.com")
    password_hash = factory.LazyFunction(lambda: hash_password("S3cretPass!"))
    status = UserStatus.online
    is_bot = False
    is_verified = True
