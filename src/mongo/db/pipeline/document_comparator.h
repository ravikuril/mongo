/**
 *    Copyright (C) 2018-present MongoDB, Inc.
 *
 *    This program is free software: you can redistribute it and/or modify
 *    it under the terms of the Server Side Public License, version 1,
 *    as published by MongoDB, Inc.
 *
 *    This program is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    Server Side Public License for more details.
 *
 *    You should have received a copy of the Server Side Public License
 *    along with this program. If not, see
 *    <http://www.mongodb.com/licensing/server-side-public-license>.
 *
 *    As a special exception, the copyright holders give permission to link the
 *    code of portions of this program with the OpenSSL library under certain
 *    conditions as described in each individual source file and distribute
 *    linked combinations including the program with the OpenSSL library. You
 *    must comply with the Server Side Public License in all respects for
 *    all of the code used other than as permitted herein. If you modify file(s)
 *    with this exception, you may extend this exception to your version of the
 *    file(s), but you are not obligated to do so. If you do not wish to do so,
 *    delete this exception statement from your version. If you delete this
 *    exception statement from all source files in the program, then also delete
 *    it in the license file.
 */

#pragma once

#include "mongo/base/string_data.h"
#include "mongo/db/pipeline/document.h"
#include "mongo/stdx/unordered_map.h"
#include "mongo/stdx/unordered_set.h"

namespace mongo {

class DocumentComparator {
public:
    /**
     * Functor compatible for use with unordered STL containers.
     */
    class EqualTo {
    public:
        explicit EqualTo(const DocumentComparator* comparator) : _comparator(comparator) {}

        bool operator()(const Document& lhs, const Document& rhs) const {
            return _comparator->compare(lhs, rhs) == 0;
        }

    private:
        const DocumentComparator* _comparator;
    };

    /**
     * Functor compatible for use with ordered STL containers.
     */
    class LessThan {
    public:
        explicit LessThan(const DocumentComparator* comparator) : _comparator(comparator) {}

        bool operator()(const Document& lhs, const Document& rhs) const {
            return _comparator->compare(lhs, rhs) < 0;
        }

    private:
        const DocumentComparator* _comparator;
    };

    /**
     * Functor for computing the hash of a Document, compatible for use with unordered STL
     * containers.
     */
    class Hasher {
    public:
        explicit Hasher(const DocumentComparator* comparator) : _comparator(comparator) {}

        size_t operator()(const Document& doc) const {
            return _comparator->hash(doc);
        }

    private:
        const DocumentComparator* _comparator;
    };

    /**
     * Constructs a document comparator with simple comparison semantics.
     */
    DocumentComparator() = default;

    /**
     * Constructs a document comparator with special string comparison semantics.
     */
    DocumentComparator(const StringData::ComparatorInterface* stringComparator)
        : _stringComparator(stringComparator) {}

    /**
     * Evaluates a deferred comparison object that was generated by invoking one of the comparison
     * operators on the Document class.
     */
    bool evaluate(Document::DeferredComparison deferredComparison) const;

    /**
     * Returns <0 if 'lhs' is less than 'rhs', 0 if 'lhs' is equal to 'rhs', and >0 if 'lhs' is
     * greater than 'rhs'.
     */
    int compare(const Document& lhs, const Document& rhs) const {
        return Document::compare(lhs, rhs, _stringComparator);
    }

    /**
     * Computes a hash of 'doc' such that Documents which compare equal under this comparator also
     * have equal hashes.
     */
    size_t hash(const Document& doc) const {
        size_t seed = 0xf0afbeef;
        doc.hash_combine(seed, _stringComparator);
        return seed;
    }

    /**
     * Returns a function object which computes whether one Document is equal to another under this
     * comparator. This comparator must outlive the returned function object.
     */
    EqualTo getEqualTo() const {
        return EqualTo(this);
    }

    /**
     * Returns a function object which computes whether one Document is less than another under this
     * comparator. This comparator must outlive the returned function object.
     */
    LessThan getLessThan() const {
        return LessThan(this);
    }

    /**
     * Returns a function object which computes the hash of a Document such that equal Documents
     * under this comparator have equal hashes.
     */
    Hasher getHasher() const {
        return Hasher(this);
    }

    /**
     * Construct an empty ordered set of Documents whose ordering and equivalence classes are given
     * by this comparator. This comparator must outlive the returned set.
     */
    std::set<Document, LessThan> makeOrderedDocumentSet() const {
        return std::set<Document, LessThan>(LessThan(this));
    }

    /**
     * Construct an empty unordered set of Documents whose equivalence classes are given by this
     * comparator. This comparator must outlive the returned set.
     */
    stdx::unordered_set<Document, Hasher, EqualTo> makeUnorderedDocumentSet() const {
        return stdx::unordered_set<Document, Hasher, EqualTo>(0, Hasher(this), EqualTo(this));
    }

    /**
     * Construct an empty ordered map from Document to type T whose ordering and equivalence classes
     * are given by this comparator. This comparator must outlive the returned set.
     */
    template <typename T>
    std::map<Document, T, LessThan> makeOrderedDocumentMap() const {
        return std::map<Document, T, LessThan>(LessThan(this));
    }

    /**
     * Construct an empty unordered map from Document to type T whose equivalence classes are given
     * by this comparator. This comparator must outlive the returned set.
     */
    template <typename T>
    stdx::unordered_map<Document, T, Hasher, EqualTo> makeUnorderedDocumentMap() const {
        return stdx::unordered_map<Document, T, Hasher, EqualTo>(0, Hasher(this), EqualTo(this));
    }

private:
    const StringData::ComparatorInterface* _stringComparator = nullptr;
};

//
// Type aliases for sets and maps of Document for use by clients of the Document/Value library.
//

using DocumentSet = std::set<Document, DocumentComparator::LessThan>;

using DocumentUnorderedSet =
    stdx::unordered_set<Document, DocumentComparator::Hasher, DocumentComparator::EqualTo>;

template <typename T>
using DocumentMap = std::map<Document, T, DocumentComparator::LessThan>;

template <typename T>
using DocumentUnorderedMap =
    stdx::unordered_map<Document, T, DocumentComparator::Hasher, DocumentComparator::EqualTo>;

}  // namespace mongo