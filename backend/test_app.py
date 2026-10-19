import unittest

from fastapi import HTTPException

import app


class BookPhysicalCodeTests(unittest.TestCase):
    def setUp(self):
        self.original_books = app.books[:]
        app.books.clear()
        app.books.extend(self.original_books[:])

    def tearDown(self):
        app.books.clear()
        app.books.extend(self.original_books)

    def add_book(self, title, grade, book_type):
        return app.create_book({
            "code": "ENG-001",
            "title": title,
            "grade": grade,
            "type": book_type,
        })

    def test_same_code_is_allowed_for_different_grades_and_types(self):
        student_book_s1 = self.add_book("English", "S1", "Student book")
        student_book_s2 = self.add_book("English", "S2", "Student book")
        student_book_s3 = self.add_book("English", "S3", "Student book")
        teacher_guide_s3 = self.add_book("English", "S3", "Teacher's guide")
        different_title = self.add_book("Mathematics", "S3", "Student book")

        self.assertEqual(student_book_s1["code"], student_book_s2["code"])
        self.assertEqual(student_book_s3["code"], teacher_guide_s3["code"])
        self.assertNotEqual(student_book_s3["id"], teacher_guide_s3["id"])
        self.assertEqual(student_book_s3["code"], different_title["code"])

    def test_same_code_title_grade_and_type_is_rejected(self):
        self.add_book("English", "S4", "Student book")

        with self.assertRaises(HTTPException) as raised:
            self.add_book(" english ", " s4 ", "STUDENT   BOOK")

        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
