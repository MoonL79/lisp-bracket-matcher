;; Test file for character literal handling

;; Character literals should NOT be matched
(define left-paren #\()
(define right-paren #\))
(define space-char #\space)
(define newline-char #\newline)

;; Normal parentheses should be matched
(define (square x)
  (* x x))

;; Vector syntax should be matched
(define vec #(1 2 3))

;; Bytevector syntax should be matched
(define bytes #vu8(65 66 67))

;; Mixed case: character literal inside a list
(define chars (list #\( #\) #\[ #\]))

;; Another test
(if (char=? ch #\()
    'left-paren
    'other)
